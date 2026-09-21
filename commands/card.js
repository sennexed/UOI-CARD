import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from 'discord.js';
import fs from 'fs';
import path from 'path';

// Optional / resilient native canvas loading (prevents bot crashes on budget host containers)
let createCanvas = null;
let loadImage = null;
try {
  const canvasPkg = await import('@napi-rs/canvas');
  createCanvas = canvasPkg.createCanvas;
  loadImage = canvasPkg.loadImage;
} catch (canvasErr) {
  console.log('[UOI Bot] Notice: @napi-rs/canvas native binary is not installed or loading; fallback embed mode active.');
}

// ========================================================
// PERSISTENT DATABASE & TEMPLATE MANAGEMENT
// ========================================================
const DATA_DIR = path.join(process.cwd(), 'data');
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
const DB_FILE = path.join(DATA_DIR, 'cards.json');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  }
  if (!fs.existsSync(TEMPLATES_DIR)) {
    try { fs.mkdirSync(TEMPLATES_DIR, { recursive: true }); } catch (_) {}
  }
}

function loadDatabase() {
  ensureDirectories();
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.cards) parsed.cards = {};
      if (!parsed.serToUser) parsed.serToUser = {};
      if (!parsed.guilds) parsed.guilds = {};
      if (!parsed.pendingRequests) parsed.pendingRequests = {};
      return parsed;
    }
  } catch (err) {
    console.error('[UOI Bot] Error reading database:', err.message);
  }
  return { cards: {}, serToUser: {}, guilds: {}, pendingRequests: {} };
}

function saveDatabase(db) {
  ensureDirectories();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[UOI Bot] Error saving database:', err.message);
  }
}

// Helper: Resolve Roblox User info and Avatar URL
async function fetchRobloxUserData(query) {
  try {
    let userId = null;
    let username = null;
    let displayName = null;

    if (/^\d+$/.test(query.trim())) {
      userId = parseInt(query.trim(), 10);
      try {
        const uResp = await fetch(`https://users.roblox.com/v1/users/${userId}`);
        if (uResp.ok) {
          const uJson = await uResp.json();
          username = uJson.name;
          displayName = uJson.displayName;
        }
      } catch (_) {}
    } else {
      const cleanName = query.trim().replace(/^@/, '');
      const searchResp = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [cleanName], excludeBannedUsers: false }),
      });
      if (searchResp.ok) {
        const sJson = await searchResp.json();
        const match = sJson.data?.[0];
        if (match) {
          userId = match.id;
          username = match.name;
          displayName = match.displayName;
        }
      }
    }

    if (!userId) {
      return { userId: null, username: query, avatarUrl: null };
    }

    const thumbResp = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=720x720&format=Png&isCircular=false`
    );
    let avatarUrl = null;
    if (thumbResp.ok) {
      const tJson = await thumbResp.json();
      avatarUrl = tJson.data?.[0]?.imageUrl || null;
    }

    return {
      userId: String(userId),
      username: username || query,
      displayName: displayName || username || query,
      avatarUrl,
    };
  } catch (err) {
    console.warn('[UOI Bot] Roblox user fetch error:', err.message);
    return { userId: null, username: query, avatarUrl: null };
  }
}

// Helper: Find or download the active template (strictly 1 template per server)
async function resolveTemplateImage(guildId) {
  ensureDirectories();

  // 1. Server-specific template check (1 template per server)
  if (guildId) {
    const serverFiles = [
      path.join(TEMPLATES_DIR, `${guildId}.png`),
      path.join(TEMPLATES_DIR, `${guildId}.jpg`),
      path.join(TEMPLATES_DIR, `${guildId}.jpeg`),
    ];
    for (const f of serverFiles) {
      if (fs.existsSync(f)) {
        try {
          const img = await loadImage(f);
          return { img, source: `Server Template (${guildId})` };
        } catch (_) {}
      }
    }
  }

  // 2. Global fallback candidates
  const candidateFiles = [
    'template.png',
    'template.jpg',
    'template.jpeg',
    './template.png',
    './template.jpg',
    'public/template.png',
    'public/template.jpg',
    path.join(TEMPLATES_DIR, 'default.png'),
  ];

  for (const filename of candidateFiles) {
    try {
      if (fs.existsSync(filename)) {
        const img = await loadImage(filename);
        return { img, source: filename };
      }
    } catch (_) {}
  }

  // 3. Environment URL check
  const envUrl = process.env.TEMPLATE_URL || process.env.CARD_TEMPLATE_URL;
  if (envUrl) {
    try {
      console.log(`[UOI Bot] Downloading template from TEMPLATE_URL: ${envUrl}`);
      const resp = await fetch(envUrl);
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync('template.png', buffer);
        const img = await loadImage(buffer);
        return { img, source: 'TEMPLATE_URL (saved as template.png)' };
      }
    } catch (err) {
      console.warn('[UOI Bot] Failed to fetch TEMPLATE_URL:', err.message);
    }
  }

  return { img: null, source: null };
}

// Helper: Render official 1200x900 UOI Citizen ID Card
async function renderCardImage({
  guildId,
  fullName,
  robloxUsername,
  robloxUserId,
  gender,
  assignedRank,
  serialId,
  avatarUrl,
}) {
  if (!createCanvas || typeof createCanvas !== 'function') {
    return { buffer: null, usedTemplate: false, source: 'canvas-library-disabled' };
  }
  const canvas = createCanvas(1200, 900);
  const ctx = canvas.getContext('2d');

  const { img: templateImg, source: templateSource } = await resolveTemplateImage(guildId);
  const templateLoaded = !!templateImg;

  if (templateLoaded) {
    // 1. OFFICIAL PERMANENT TEMPLATE
    ctx.drawImage(templateImg, 0, 0, 1200, 900);

    // Top-Right Serial ID
    ctx.save();
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 14px "Courier New", Courier, monospace';
    ctx.fillText(serialId, 1010, 36);
    ctx.restore();

    // Rank Box below portrait
    const rankBoxX = 54;
    const rankBoxY = 687;
    const rankBoxW = 348;
    const rankBoxH = 46;

    ctx.save();
    ctx.fillStyle = '#080d19';
    ctx.beginPath();
    ctx.roundRect(rankBoxX, rankBoxY, rankBoxW, rankBoxH, 4);
    ctx.fill();
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(assignedRank.toUpperCase(), rankBoxX + rankBoxW / 2, rankBoxY + 31);
    ctx.textAlign = 'left';
    ctx.restore();

    // 5 Field Rows
    const fieldX = 472;
    const fieldValues = [
      { val: fullName, textY: 358 },
      { val: robloxUsername ? `@${robloxUsername}` : '', textY: 446 },
      { val: robloxUserId || '', textY: 534 },
      { val: gender || '', textY: 622 },
      { val: assignedRank || '', textY: 710 },
    ];

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px sans-serif';
    fieldValues.forEach((f) => {
      if (f.val) {
        ctx.fillText(f.val, fieldX + 18, f.textY);
      }
    });
    ctx.restore();

    // Portrait inside official frame
    const photoX = 60;
    const photoY = 324;
    const photoW = 337;
    const photoH = 344;

    if (avatarUrl) {
      try {
        const avatarImg = await loadImage(avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.rect(photoX, photoY, photoW, photoH);
        ctx.clip();
        ctx.drawImage(avatarImg, photoX, photoY, photoW, photoH);
        ctx.restore();
      } catch (err) {
        console.warn('[UOI Bot] Could not load avatar image:', err.message);
      }
    }
  } else {
    // 2. FALLBACK DESIGN (Only if template image has not yet been set)
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 900);
    bgGrad.addColorStop(0, '#0a0f1d');
    bgGrad.addColorStop(0.5, '#070b16');
    bgGrad.addColorStop(1, '#04070e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 900);

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, 1164, 864);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('UNION OF INDIANS', 160, 95);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(serialId, 895, 91);

    const fields = [
      { label: 'FULL CITIZEN NAME', value: fullName },
      { label: 'ROBLOX USERNAME', value: robloxUsername ? `@${robloxUsername}` : 'UNLINKED' },
      { label: 'ROBLOX USER ID', value: robloxUserId || 'N/A' },
      { label: 'GENDER', value: gender || 'N/A' },
      { label: 'RANK / ROLE', value: assignedRank || 'COMMUNITY MEMBER' },
    ];

    fields.forEach((f, idx) => {
      const boxY = 260 + idx * 78;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText(f.value, 485, boxY + 58);
    });

    if (avatarUrl) {
      try {
        const avatarImg = await loadImage(avatarUrl);
        ctx.drawImage(avatarImg, 56, 260, 345, 380);
      } catch (_) {}
    }
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    usedTemplate: templateLoaded,
    source: templateSource,
  };
}

export const cardCommand = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Official UOI Identification System')
    // 0. /card setup (Required initial configuration)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Configure UOI ID Card routing and review channels for this server (Admins Only)')
        .addChannelOption((opt) =>
          opt
            .setName('staff_channel')
            .setDescription('Staff channel where citizen card applications and approval requests are sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('delivery_channel')
            .setDescription('Channel where approved cards will be announced (Optional)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addRoleOption((opt) =>
          opt
            .setName('staff_role')
            .setDescription('Officer or staff role permitted to approve or decline cards (Optional)')
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('auto_nickname')
            .setDescription('Automatically update member nickname to "Name [Serial]" upon approval (Default: True)')
            .setRequired(false)
        )
    )
    // 1. /card generate (Routes to staff review)
    .addSubcommand((sub) =>
      sub
        .setName('generate')
        .setDescription('Submit application for official UOI ID card (Routes to Staff Review Queue)')
        .addStringOption((opt) =>
          opt.setName('roblox').setDescription('Roblox Username or numerical ID').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('fullname').setDescription('Full Citizen Name').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('gender').setDescription('Gender (Male / Female / Other)').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('rank').setDescription('Rank / Role (e.g. PRESIDENT, PRIME MINISTER, COMMUNITY MEMBER)')
        )
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member (leave empty to apply for yourself)')
        )
    )
    // 2. /card show (NEW: Pulls card of user from database)
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Display an official UOI ID card from the database')
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member to look up (leave empty to view your own card)')
        )
    )
    // 3. /card set-template (1 template per server)
    .addSubcommand((sub) =>
      sub
        .setName('set-template')
        .setDescription('Upload or update this server\'s official card template (1 per server)')
        .addAttachmentOption((opt) =>
          opt.setName('image').setDescription('Attach the official template image (PNG or JPG)')
        )
        .addStringOption((opt) =>
          opt.setName('url').setDescription('Or paste a direct image URL (Discord CDN, Imgur, etc.)')
        )
    )
    // 4. /card view-template
    .addSubcommand((sub) =>
      sub
        .setName('view-template')
        .setDescription('View the current active card template for this server')
    )
    // 5. /card verify [serial_id]
    .addSubcommand((sub) =>
      sub
        .setName('verify')
        .setDescription('Verify the authenticity of an issued UOI card serial ID in database')
        .addStringOption((opt) =>
          opt.setName('serial').setDescription('e.g. UOI-2026-839201').setRequired(true)
        )
    )
    // 6. /card inspect @user
    .addSubcommand((sub) =>
      sub
        .setName('inspect')
        .setDescription('Inspect citizen dossier, card status, and record history')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Target Discord user').setRequired(true)
        )
    )
    // 7. /card promote
    .addSubcommand((sub) =>
      sub
        .setName('promote')
        .setDescription('Promote a citizen to a new rank tier (Officer Only)')
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('rank').setDescription('Target rank tier').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Promotion justification')
        )
    )
    // 8. /card revoke
    .addSubcommand((sub) =>
      sub
        .setName('revoke')
        .setDescription('Revoke a citizen ID card (Security Command Only)')
        .addStringOption((opt) =>
          opt.setName('serial').setDescription('Serial ID to revoke').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason for revocation').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const issuingOfficer = {
      discordId: interaction.user.id,
      discordTag: interaction.user.tag,
    };

    // ==========================================
    // COMMAND: /card setup (Required initial setup)
    // ==========================================
    if (sub === 'setup') {
      await interaction.deferReply({ ephemeral: false });

      // Check permission: ManageGuild or Administrator
      if (
        interaction.member &&
        !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only server administrators or members with `Manage Server` can configure the UOI Card System.',
        });
      }

      const staffChannel = interaction.options.getChannel('staff_channel');
      const deliveryChannel = interaction.options.getChannel('delivery_channel');
      const staffRole = interaction.options.getRole('staff_role');
      const autoNickname = interaction.options.getBoolean('auto_nickname') ?? true;

      const db = loadDatabase();
      db.guilds = db.guilds || {};
      db.guilds[guildId] = {
        isSetup: true,
        staffChannelId: staffChannel.id,
        staffChannelName: staffChannel.name,
        deliveryChannelId: deliveryChannel ? deliveryChannel.id : null,
        deliveryChannelName: deliveryChannel ? deliveryChannel.name : null,
        staffRoleId: staffRole ? staffRole.id : null,
        staffRoleName: staffRole ? staffRole.name : null,
        autoNickname,
        setupAt: new Date().toISOString(),
        setupBy: {
          discordId: interaction.user.id,
          discordTag: interaction.user.tag,
        },
      };
      saveDatabase(db);

      const embed = new EmbedBuilder()
        .setTitle('⚙️ UOI ID Card System Setup Complete!')
        .setColor(0x10b981)
        .setDescription(
          `**The Union of Indians ID Card System is now fully configured and ACTIVE on ${interaction.guild?.name || 'this server'}!**\n\n` +
          `All citizen card commands are now **unlocked** and ready for use.`
        )
        .addFields(
          {
            name: '📥 Staff Review Channel',
            value: `<#${staffChannel.id}> (\`${staffChannel.name}\`)\n*Incoming \`/card generate\` requests will be posted here with interactive Accept & Decline controls.*`,
            inline: false,
          },
          {
            name: '📬 Card Delivery Channel',
            value: deliveryChannel ? `<#${deliveryChannel.id}> (\`${deliveryChannel.name}\`)` : '*(Default: Posts in applicant\'s current channel)*',
            inline: true,
          },
          {
            name: '🛡️ Authorized Reviewers',
            value: staffRole ? `<@&${staffRole.id}>` : '*Server Administrators & Officers*',
            inline: true,
          },
          {
            name: '🏷️ Auto-Nicknaming',
            value: autoNickname ? '✅ Enabled (`Name [Serial]`)' : '❌ Disabled',
            inline: true,
          },
          {
            name: '📋 What happens next?',
            value:
              `1. Citizens can run \`/card generate\` to apply for their card.\n` +
              `2. Applications go directly to <#${staffChannel.id}> for staff review.\n` +
              `3. Staff can click **[✅ Accept & Issue Card]** or **[❌ Decline with Reason]**.\n` +
              `4. You can customize the official card background anytime using \`/card set-template\`!`,
          }
        )
        .setFooter({ text: 'Union of Indians Official Bot Registry' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // SERVER SETUP GUARD: If not setup, lock all other commands!
    // ==========================================
    const db = loadDatabase();
    const guildConfig = db.guilds?.[guildId];
    if (!guildConfig || !guildConfig.isSetup || !guildConfig.staffChannelId) {
      const embed = new EmbedBuilder()
        .setTitle('🔒 UOI Identification System: Server Setup Required')
        .setColor(0xef4444)
        .setDescription(
          `**This server has not completed UOI Bot setup yet!**\n\n` +
          `All citizen card generation, inspection, verification, and registry commands remain **locked and inactive** until an Administrator configures the server routing.`
        )
        .addFields(
          {
            name: '🛠️ How to Unlock Commands?',
            value: 'A server Administrator must run `/card setup` and specify the **staff_channel** where citizen card applications and approval requests will be delivered.',
          },
          {
            name: '👑 Required Permissions',
            value: '`Administrator` or `Manage Server`',
          }
        )
        .setFooter({ text: 'Union of Indians Registry • Configuration Lock' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ==========================================
    // COMMAND: /card set-template (1 template per server)
    // ==========================================
    if (sub === 'set-template') {
      await interaction.deferReply({ ephemeral: false });

      // Check permission: ManageGuild or Administrator
      if (interaction.member && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only server administrators or members with `Manage Server` can set this server\'s official card template.',
        });
      }

      const attachment = interaction.options.getAttachment('image');
      const urlInput = interaction.options.getString('url');
      const downloadUrl = attachment ? attachment.url : urlInput ? urlInput.trim() : null;

      if (!downloadUrl) {
        return interaction.editReply({
          content: '❌ **Please attach an image** or provide a direct image `url` when running `/card set-template`.',
        });
      }

      try {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) {
          return interaction.editReply({
            content: `❌ Could not download image from the provided source (HTTP ${resp.status}).`,
          });
        }

        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const testImg = await loadImage(buffer);

        ensureDirectories();

        // Enforce 1 template per server: remove any old extension and save template_<guildId>.png
        if (guildId) {
          for (const ext of ['png', 'jpg', 'jpeg']) {
            const oldPath = path.join(TEMPLATES_DIR, `${guildId}.${ext}`);
            if (fs.existsSync(oldPath)) {
              try { fs.unlinkSync(oldPath); } catch (_) {}
            }
          }
          fs.writeFileSync(path.join(TEMPLATES_DIR, `${guildId}.png`), buffer);
        }

        // Also save to root template.png as fallback
        fs.writeFileSync('template.png', buffer);
        try {
          if (!fs.existsSync('public')) fs.mkdirSync('public');
          fs.writeFileSync('public/template.png', buffer);
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setTitle('✅ Official Server Template Saved')
          .setColor(0x10b981)
          .setDescription(
            `Successfully set the **official template** for **${interaction.guild ? interaction.guild.name : 'this server'}** (\`${testImg.width}×${testImg.height}px\`).\n` +
            `🔒 **Policy Enforced:** Exactly **1 template per server**. Any previous server template has been superseded.\n` +
            `All future cards generated or viewed with \`/card show\` in this server will stamp directly onto this official template!`
          )
          .addFields(
            { name: 'Server ID', value: `\`${guildId || 'Global'}\``, inline: true },
            { name: 'Storage Slot', value: guildId ? `templates/${guildId}.png` : 'template.png', inline: true },
            { name: 'Resolution', value: `${testImg.width} × ${testImg.height} px`, inline: true }
          )
          .setFooter({ text: 'Union of Indians Registry • Single-Template Server Isolation' })
          .setTimestamp();

        const file = new AttachmentBuilder(buffer, { name: 'server-template.png' });
        embed.setImage('attachment://server-template.png');

        return interaction.editReply({ embeds: [embed], files: [file] });
      } catch (err) {
        console.error('[UOI Bot] Error setting template:', err);
        return interaction.editReply({
          content: `❌ **Failed to process template image:** ${err.message}`,
        });
      }
    }

    // ==========================================
    // COMMAND: /card view-template
    // ==========================================
    if (sub === 'view-template') {
      await interaction.deferReply({ ephemeral: true });

      const { img, source } = await resolveTemplateImage(guildId);
      if (!img) {
        return interaction.editReply({
          content:
            '⚠️ **No permanent template found for this server!**\nUse `/card set-template` with your template image attached to upload one (1 template per server).',
        });
      }

      let fileBuffer = null;
      if (guildId && fs.existsSync(path.join(TEMPLATES_DIR, `${guildId}.png`))) {
        fileBuffer = fs.readFileSync(path.join(TEMPLATES_DIR, `${guildId}.png`));
      } else {
        for (const f of ['template.png', 'template.jpg', 'public/template.png']) {
          if (fs.existsSync(f)) {
            fileBuffer = fs.readFileSync(f);
            break;
          }
        }
      }

      if (!fileBuffer) {
        return interaction.editReply({
          content: `Active template loaded from: \`${source}\` (${img.width}×${img.height}px)`,
        });
      }

      const file = new AttachmentBuilder(fileBuffer, { name: 'active-template.png' });
      const embed = new EmbedBuilder()
        .setTitle('🖼️ Active Server Card Template')
        .setColor(0x3b82f6)
        .setDescription(`Loaded template for **${interaction.guild ? interaction.guild.name : 'this server'}**:\n• Source: \`${source}\`\n• Resolution: **${img.width}×${img.height}px**`)
        .setImage('attachment://active-template.png');

      return interaction.editReply({ embeds: [embed], files: [file] });
    }

    // ==========================================
    // COMMAND: /card show (Pull card from database)
    // ==========================================
    if (sub === 'show') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen') || interaction.user;

      const db = loadDatabase();
      const card = db.cards[targetUser.id];

      if (!card || card.status === 'REVOKED') {
        const embed = new EmbedBuilder()
          .setTitle('🔍 UOI Central Registry Search')
          .setColor(0xEF4444)
          .setDescription(`No active UOI Citizen ID card found in the database for <@${targetUser.id}>.`)
          .addFields(
            { name: 'Target Citizen', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
            { name: 'Registry Status', value: card?.status === 'REVOKED' ? '🔴 REVOKED' : '⚪ Unregistered', inline: true },
            { name: 'Issuance Protocol', value: 'An authorized officer can issue a card using `/card generate`.' }
          )
          .setFooter({ text: 'Union of Indians Central Registry Database' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Render the citizen's card on demand using the server's official template
      let cardBuffer = null;
      let usedTemplate = false;
      let templateSource = null;
      try {
        const renderResult = await renderCardImage({
          guildId,
          fullName: card.fullName,
          robloxUsername: card.robloxUsername,
          robloxUserId: card.robloxUserId,
          gender: card.gender,
          assignedRank: card.assignedRank,
          serialId: card.serialId,
          avatarUrl: card.avatarUrl,
        });
        cardBuffer = renderResult.buffer;
        usedTemplate = renderResult.usedTemplate;
        templateSource = renderResult.source;
      } catch (err) {
        console.error('[UOI Bot] Error rendering stored card image:', err);
      }

      const fileName = `${card.serialId}.png`;
      const files = [];

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ UOI Citizen ID Card: ${card.fullName}`)
        .setColor(0x10b981)
        .setDescription(`Official identity credential retrieved from database for <@${card.discordId}>`)
        .addFields(
          { name: 'Card Serial ID', value: `\`${card.serialId}\``, inline: true },
          { name: 'Citizen', value: `<@${card.discordId}>`, inline: true },
          {
            name: 'Roblox Identity',
            value: card.robloxUserId
              ? `[@${card.robloxUsername}](https://www.roblox.com/users/${card.robloxUserId}/profile)`
              : `@${card.robloxUsername || 'Unlinked'}`,
            inline: true,
          },
          { name: 'Rank Tier', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Gender', value: card.gender || 'N/A', inline: true },
          { name: 'Issuing Officer', value: `<@${card.issuedBy?.discordId || card.issuedBy}>`, inline: true },
          {
            name: 'Issued Date',
            value: `<t:${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:f>`,
            inline: true,
          },
          { name: 'Registry Status', value: '🟢 ACTIVE & VERIFIED', inline: true }
        )
        .setFooter({
          text: usedTemplate
            ? `Central Database Record • Stamped with ${templateSource}`
            : 'Central Database Record • Union of Indians',
        })
        .setTimestamp();

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(`attachment://${fileName}`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // ==========================================
    // COMMAND 1: /card generate (Routes to staff review)
    // ==========================================
    if (sub === 'generate') {
      await interaction.deferReply({ ephemeral: false });

      const targetUser = interaction.options.getUser('citizen') || interaction.user;
      const robloxQuery = interaction.options.getString('roblox');
      const fullName = interaction.options.getString('fullname');
      const gender = interaction.options.getString('gender');
      const assignedRank = (interaction.options.getString('rank') || 'COMMUNITY MEMBER').toUpperCase();

      // STRICT RULE 1: Only 1 card per person!
      const db = loadDatabase();
      const existingCard = db.cards[targetUser.id];
      if (existingCard && existingCard.status === 'ACTIVE') {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Card Generation Blocked: 1 Card Per Person')
          .setColor(0xf59e0b)
          .setDescription(
            `**<@${targetUser.id}> already possesses an active UOI Citizen Card!**\n` +
            `Under Union regulations, each citizen is restricted to exactly **one card**.`
          )
          .addFields(
            { name: 'Existing Serial ID', value: `\`${existingCard.serialId}\``, inline: true },
            { name: 'Full Name', value: existingCard.fullName, inline: true },
            { name: 'Current Rank', value: `**${existingCard.assignedRank}**`, inline: true },
            { name: 'Roblox Username', value: `@${existingCard.robloxUsername || 'Unlinked'}`, inline: true },
            { name: 'Status', value: '🟢 ACTIVE CITIZEN', inline: true },
            {
              name: 'Issued On',
              value: `<t:${Math.floor(new Date(existingCard.issuedAt).getTime() / 1000)}:R>`,
              inline: true,
            }
          )
          .addFields({
            name: '📋 What to do?',
            value:
              `• Run \`/card show citizen:@${targetUser.username}\` to display their existing registered card.\n` +
              `• To update their rank tier, use \`/card promote\` instead.\n` +
              `• If the previous card was lost or compromised, an authorized officer must run \`/card revoke serial:${existingCard.serialId}\` before re-issuing.`,
          })
          .setFooter({ text: 'Union of Indians Registry • Strict Single-Card Enforcement' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Check if citizen already has a pending request awaiting review
      const existingPending = Object.values(db.pendingRequests || {}).find(
        (r) => r.status === 'PENDING' && r.targetUser?.id === targetUser.id
      );
      if (existingPending) {
        const embed = new EmbedBuilder()
          .setTitle('⏳ Card Request Already Pending Review')
          .setColor(0xf59e0b)
          .setDescription(
            `**<@${targetUser.id}> already has an active card request awaiting staff review!**\n` +
            `Please wait for staff to review the current application in <#${guildConfig.staffChannelId}>.`
          )
          .addFields(
            { name: 'Request ID', value: `\`${existingPending.id}\``, inline: true },
            {
              name: 'Submitted At',
              value: `<t:${Math.floor(new Date(existingPending.submittedAt).getTime() / 1000)}:R>`,
              inline: true,
            },
            { name: 'Status', value: '🟡 Awaiting Officer Approval', inline: true }
          )
          .setFooter({ text: 'Union of Indians Staff Review Queue' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Fetch Roblox details & avatar
      const robloxInfo = await fetchRobloxUserData(robloxQuery);

      const requestId = `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Save pending request to database
      db.pendingRequests = db.pendingRequests || {};
      const requestRecord = {
        id: requestId,
        guildId,
        targetUser: {
          id: targetUser.id,
          tag: targetUser.tag,
        },
        applicantUser: {
          id: interaction.user.id,
          tag: interaction.user.tag,
        },
        fullName,
        gender,
        assignedRank,
        robloxUsername: robloxInfo.username,
        robloxUserId: robloxInfo.userId,
        robloxAvatarUrl: robloxInfo.avatarUrl,
        submittedAt: new Date().toISOString(),
        status: 'PENDING',
        declineReason: null,
        reviewedBy: null,
        reviewedAt: null,
        issuedSerialId: null,
        staffChannelId: null,
        staffMessageId: null,
      };
      db.pendingRequests[requestId] = requestRecord;
      saveDatabase(db);

      // Post interactive review card into the Staff Channel
      let postedToStaff = false;
      try {
        const staffChannel = await interaction.guild.channels.fetch(guildConfig.staffChannelId);
        if (staffChannel && staffChannel.isTextBased()) {
          const staffEmbed = new EmbedBuilder()
            .setTitle(`🛡️ New Citizen Card Application: ${fullName}`)
            .setColor(0xf59e0b)
            .setDescription(
              `A citizen identification card application has been submitted and is awaiting staff approval.\n\n` +
              `• **Citizen:** <@${targetUser.id}> (\`${targetUser.tag}\`)\n` +
              `• **Submitted By:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)`
            )
            .addFields(
              { name: 'Full Citizen Name', value: fullName, inline: true },
              { name: 'Gender', value: gender, inline: true },
              { name: 'Requested Rank', value: `**${assignedRank}**`, inline: true },
              {
                name: 'Roblox Identity',
                value: robloxInfo.userId
                  ? `[@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile) (\`ID: ${robloxInfo.userId}\`)`
                  : `@${robloxInfo.username}`,
                inline: true,
              },
              { name: 'Request ID', value: `\`${requestId}\``, inline: true },
              { name: 'Submitted At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: `UOI Staff Review Queue • Request ${requestId}` })
            .setTimestamp();

          if (robloxInfo.avatarUrl) {
            staffEmbed.setThumbnail(robloxInfo.avatarUrl);
          }

          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`card_accept_${requestId}`)
              .setLabel('Accept & Issue Card')
              .setStyle(ButtonStyle.Success)
              .setEmoji('✅'),
            new ButtonBuilder()
              .setCustomId(`card_decline_${requestId}`)
              .setLabel('Decline with Reason')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('❌')
          );

          const sentMsg = await staffChannel.send({ embeds: [staffEmbed], components: [actionRow] });
          requestRecord.staffChannelId = staffChannel.id;
          requestRecord.staffMessageId = sentMsg.id;
          saveDatabase(db);
          postedToStaff = true;
        }
      } catch (staffErr) {
        console.error('[UOI Bot] Could not post to staff review channel:', staffErr.message);
      }

      // Inform the user that the request has been routed to staff
      const applicantEmbed = new EmbedBuilder()
        .setTitle('📋 Application Submitted for Staff Review')
        .setColor(0x38bdf8)
        .setDescription(
          `**Your UOI Citizen Card application has been dispatched to Staff!**\n\n` +
          `Under Union procedure, ID cards are not issued instantly. Your application has been routed to the staff review channel for officer verification.`
        )
        .addFields(
          { name: 'Request ID', value: `\`${requestId}\``, inline: true },
          { name: 'Target Citizen', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Full Name', value: fullName, inline: true },
          {
            name: 'Roblox Identity',
            value: robloxInfo.userId
              ? `[@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile)`
              : `@${robloxInfo.username}`,
            inline: true,
          },
          { name: 'Requested Rank', value: `**${assignedRank}**`, inline: true },
          {
            name: 'Staff Review Channel',
            value: `<#${guildConfig.staffChannelId}>`,
            inline: true,
          },
          {
            name: '⏱️ What happens next?',
            value:
              '• Union officers will inspect your Roblox account and information in staff chat.\n' +
              '• When **Accepted**, your official card is rendered, delivered, and your nickname updated.\n' +
              '• If **Declined**, staff will provide a specific reason and you will receive a notification.',
          }
        )
        .setFooter({ text: 'Union of Indians Central Registry • Verification Queue' })
        .setTimestamp();

      if (!postedToStaff) {
        applicantEmbed.addFields({
          name: '⚠️ Notice',
          value: 'Could not directly post to configured staff channel. Staff may review this via `/card requests` or bot dashboard.',
        });
      }

      return interaction.editReply({ embeds: [applicantEmbed] });
    }

    // ==========================================
    // COMMAND: /card verify [serial]
    // ==========================================
    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const db = loadDatabase();
      const userId = db.serToUser?.[serial];
      const card = userId ? db.cards[userId] : null;

      if (!card) {
        const embed = new EmbedBuilder()
          .setTitle(`Citizen Card Verification: ${serial}`)
          .setColor(0xef4444)
          .setDescription(`❌ **UNVERIFIED OR FRAUDULENT SERIAL ID**\nSerial \`${serial}\` was not found in the official UOI database.`)
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      const isActive = card.status === 'ACTIVE';
      const embed = new EmbedBuilder()
        .setTitle(`Citizen Card Verification: ${serial}`)
        .setColor(isActive ? 0x10b981 : 0xef4444)
        .setDescription(
          isActive
            ? `✅ **AUTHENTIC UOI CITIZEN CARD**\nStatus: **ACTIVE & VERIFIED**\nRegistered in Central Registry.`
            : `🚨 **REVOKED CITIZEN CARD**\nThis credential was revoked and is no longer valid.`
        )
        .addFields(
          { name: 'Citizen', value: `<@${card.discordId}>`, inline: true },
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Roblox', value: `@${card.robloxUsername || 'Unlinked'}`, inline: true },
          { name: 'Rank Tier', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Issuing Officer', value: `<@${card.issuedBy?.discordId || card.issuedBy}>`, inline: true },
          { name: 'Issued Date', value: `<t:${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:d>`, inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card inspect @user
    // ==========================================
    if (sub === 'inspect') {
      const targetUser = interaction.options.getUser('user');
      const db = loadDatabase();
      const card = db.cards[targetUser.id];

      const embed = new EmbedBuilder()
        .setTitle(`Citizen Dossier: ${targetUser.tag}`)
        .setColor(card?.status === 'ACTIVE' ? 0x6366f1 : 0x64748b)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Discord ID', value: `\`${targetUser.id}\``, inline: true },
          {
            name: 'Citizen Card Status',
            value: card?.status === 'ACTIVE' ? `🟢 Active (\`${card.serialId}\`)` : card?.status === 'REVOKED' ? '🔴 Revoked' : '⚪ None Registered',
            inline: true,
          }
        );

      if (card) {
        embed.addFields(
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Roblox Username', value: `@${card.robloxUsername || 'Unlinked'}`, inline: true },
          { name: 'Rank Tier', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Issued At', value: `<t:${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:f>`, inline: true }
        );
      }

      embed.setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card promote
    // ==========================================
    if (sub === 'promote') {
      const targetUser = interaction.options.getUser('citizen');
      const newRank = interaction.options.getString('rank').toUpperCase();
      const reason = interaction.options.getString('reason') || 'Commendable service to the Union';

      const db = loadDatabase();
      const card = db.cards[targetUser.id];
      if (card && card.status === 'ACTIVE') {
        card.assignedRank = newRank;
        card.promotedAt = new Date().toISOString();
        saveDatabase(db);
      }

      const embed = new EmbedBuilder()
        .setTitle('🎖️ Citizen Promotion Granted')
        .setColor(0x3b82f6)
        .addFields(
          { name: 'Citizen', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Promoted To', value: `**${newRank}**`, inline: true },
          { name: 'Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Justification', value: reason }
        )
        .setFooter({ text: card ? 'Database record updated successfully' : 'Notice: No database card on file' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card revoke
    // ==========================================
    if (sub === 'revoke') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const reason = interaction.options.getString('reason');

      const db = loadDatabase();
      const userId = db.serToUser?.[serial];
      if (userId && db.cards[userId]) {
        db.cards[userId].status = 'REVOKED';
        db.cards[userId].revokedAt = new Date().toISOString();
        db.cards[userId].revokeReason = reason;
        saveDatabase(db);
      }

      const embed = new EmbedBuilder()
        .setTitle('🚨 UOI Citizen ID Card REVOKED')
        .setColor(0xef4444)
        .setDescription('⚠️ **THIS CITIZEN CARD HAS BEEN REVOKED & BLACKLISTED**')
        .addFields(
          { name: 'Serial ID', value: `\`${serial}\``, inline: true },
          { name: 'Revoking Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Reason', value: reason },
          { name: 'Re-issuance Status', value: 'Citizen is now cleared to receive a newly authorized card if appropriate.' }
        )
        .setFooter({ text: 'Database entry marked as REVOKED' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },

  // ==========================================
  // INTERACTION HANDLERS: Staff Review Buttons
  // ==========================================
  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const db = loadDatabase();
    const guildConfig = db.guilds?.[guildId];

    // Staff permission check
    if (guildConfig?.staffRoleId) {
      const hasStaffRole = interaction.member?.roles?.cache?.has(guildConfig.staffRoleId);
      const isAdmin =
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!hasStaffRole && !isAdmin) {
        return interaction.reply({
          content: `❌ **Permission Denied:** You need the <@&${guildConfig.staffRoleId}> role to review citizen card applications.`,
          ephemeral: true,
        });
      }
    } else {
      const isAdmin =
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!isAdmin) {
        return interaction.reply({
          content: '❌ **Permission Denied:** Only administrators or members with `Manage Server` can review citizen card applications.',
          ephemeral: true,
        });
      }
    }

    // 1. ACCEPT & ISSUE CARD
    if (customId.startsWith('card_accept_')) {
      const requestId = customId.replace('card_accept_', '');
      const req = db.pendingRequests?.[requestId];

      if (!req) {
        return interaction.reply({
          content: `❌ Card application record \`${requestId}\` not found in the database.`,
          ephemeral: true,
        });
      }

      if (req.status !== 'PENDING') {
        return interaction.reply({
          content: `⚠️ This card application has already been marked as **${req.status}** by <@${req.reviewedBy?.discordId || 'Staff'}>.`,
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      // Generate Serial ID & Server Nickname
      const serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const serverNickname = `${req.fullName} [${serialId}]`;

      // Render Card Image with server's active template
      let cardBuffer = null;
      let usedTemplate = false;
      let templateSource = null;
      try {
        const renderResult = await renderCardImage({
          guildId,
          fullName: req.fullName,
          robloxUsername: req.robloxUsername,
          robloxUserId: req.robloxUserId,
          gender: req.gender,
          assignedRank: req.assignedRank,
          serialId,
          avatarUrl: req.robloxAvatarUrl,
        });
        cardBuffer = renderResult.buffer;
        usedTemplate = renderResult.usedTemplate;
        templateSource = renderResult.source;
      } catch (err) {
        console.error('[UOI Bot] Error rendering approved card image:', err);
      }

      // Save to active card database
      const newCardRecord = {
        discordId: req.targetUser.id,
        discordTag: req.targetUser.tag,
        guildId: guildId || null,
        serialId,
        fullName: req.fullName,
        robloxUsername: req.robloxUsername,
        robloxUserId: req.robloxUserId,
        gender: req.gender,
        assignedRank: req.assignedRank,
        avatarUrl: req.robloxAvatarUrl,
        issuedBy: {
          discordId: interaction.user.id,
          discordTag: interaction.user.tag,
        },
        issuedAt: new Date().toISOString(),
        serverNickname,
        status: 'ACTIVE',
      };
      db.cards[req.targetUser.id] = newCardRecord;
      db.serToUser = db.serToUser || {};
      db.serToUser[serialId] = req.targetUser.id;

      // Update pending request status
      req.status = 'APPROVED';
      req.reviewedBy = { discordId: interaction.user.id, discordTag: interaction.user.tag };
      req.reviewedAt = new Date().toISOString();
      req.issuedSerialId = serialId;
      saveDatabase(db);

      // Edit staff message to show approved state
      try {
        const staffMsgEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0x10b981)
          .setTitle(`✅ Citizen Card Approved & Issued: ${req.fullName}`)
          .addFields(
            { name: 'Decision', value: `✅ **APPROVED** by <@${interaction.user.id}>`, inline: true },
            { name: 'Serial ID Issued', value: `\`${serialId}\``, inline: true }
          );

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('card_done_btn')
            .setLabel(`Approved by @${interaction.user.username}`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
            .setEmoji('✅')
        );

        await interaction.message.edit({ embeds: [staffMsgEmbed], components: [disabledRow] });
      } catch (staffEditErr) {
        console.warn('[UOI Bot] Could not edit staff review message:', staffEditErr.message);
      }

      // Automatically update server nickname if enabled
      if (guildConfig?.autoNickname !== false) {
        try {
          const member = await interaction.guild.members.fetch(req.targetUser.id);
          if (member && member.manageable) {
            await member.setNickname(serverNickname);
          }
        } catch (nickErr) {
          console.warn('[UOI Bot] Nickname update failed:', nickErr.message);
        }
      }

      // Deliver card to delivery channel or applicant
      const fileName = `${serialId}.png`;
      const files = [];
      if (cardBuffer) {
        files.push(new AttachmentBuilder(cardBuffer, { name: fileName }));
      }

      const deliveryEmbed = new EmbedBuilder()
        .setTitle(`🛡️ Official UOI Citizen Card Issued: ${req.fullName}`)
        .setColor(usedTemplate ? 0x10b981 : 0xf59e0b)
        .setDescription(
          `🎉 **Congratulations <@${req.targetUser.id}>! Your application has been approved by staff.**\n` +
          `Your official Union of Indians identification credential is registered in the database.`
        )
        .addFields(
          { name: 'Serial ID', value: `\`${serialId}\``, inline: true },
          { name: 'Citizen Name', value: req.fullName, inline: true },
          { name: 'Rank Tier', value: `**${req.assignedRank}**`, inline: true },
          {
            name: 'Roblox Account',
            value: req.robloxUserId
              ? `[@${req.robloxUsername}](https://www.roblox.com/users/${req.robloxUserId}/profile)`
              : `@${req.robloxUsername}`,
            inline: true,
          },
          { name: 'Approving Officer', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Assigned Nickname', value: `\`${serverNickname}\``, inline: true }
        )
        .setFooter({
          text: usedTemplate
            ? `Central Registry Record • Stamped with ${templateSource}`
            : 'Central Registry Record • Union of Indians',
        })
        .setTimestamp();

      if (cardBuffer) {
        deliveryEmbed.setImage(`attachment://${fileName}`);
      }

      // Dispatch to Delivery channel if configured
      try {
        let targetDeliveryChan = null;
        if (guildConfig?.deliveryChannelId) {
          targetDeliveryChan = await interaction.guild.channels.fetch(guildConfig.deliveryChannelId);
        }
        if (targetDeliveryChan && targetDeliveryChan.isTextBased()) {
          await targetDeliveryChan.send({
            content: `📢 Citizen Card Approved for <@${req.targetUser.id}>!`,
            embeds: [deliveryEmbed],
            files,
          });
        }
      } catch (delChanErr) {
        console.warn('[UOI Bot] Delivery channel dispatch error:', delChanErr.message);
      }

      return interaction.editReply({
        content: `✅ **Card Successfully Issued!**\nSerial ID: \`${serialId}\` created for <@${req.targetUser.id}>. Server database and records have been updated.`,
      });
    }

    // 2. DECLINE WITH REASON (Pops up modal)
    if (customId.startsWith('card_decline_')) {
      const requestId = customId.replace('card_decline_', '');
      const req = db.pendingRequests?.[requestId];

      if (!req) {
        return interaction.reply({
          content: `❌ Card application \`${requestId}\` not found in database.`,
          ephemeral: true,
        });
      }

      if (req.status !== 'PENDING') {
        return interaction.reply({
          content: `⚠️ This request has already been marked as **${req.status}** by <@${req.reviewedBy?.discordId || 'Staff'}>.`,
          ephemeral: true,
        });
      }

      // Pop up a modal asking the officer for the decline reason
      const modal = new ModalBuilder()
        .setCustomId(`card_modal_decline_${requestId}`)
        .setTitle('Decline Citizen Card Application');

      const reasonInput = new TextInputBuilder()
        .setCustomId('decline_reason')
        .setLabel('Reason for Rejection')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('State why this application is rejected (e.g. Invalid Roblox account, incorrect rank, troll name)...')
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(500);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }
  },

  // ==========================================
  // MODAL SUBMIT HANDLER: Decline with Reason
  // ==========================================
  async handleModal(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('card_modal_decline_')) return;

    const requestId = customId.replace('card_modal_decline_', '');
    const reason = interaction.fields.getTextInputValue('decline_reason');
    const guildId = interaction.guildId;
    const db = loadDatabase();
    const guildConfig = db.guilds?.[guildId];
    const req = db.pendingRequests?.[requestId];

    if (!req) {
      return interaction.reply({ content: `❌ Request \`${requestId}\` was not found.`, ephemeral: true });
    }

    if (req.status !== 'PENDING') {
      return interaction.reply({ content: `⚠️ Request is already marked as ${req.status}.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    req.status = 'DECLINED';
    req.declineReason = reason;
    req.reviewedBy = { discordId: interaction.user.id, discordTag: interaction.user.tag };
    req.reviewedAt = new Date().toISOString();
    saveDatabase(db);

    // Update the message in the staff channel
    if (req.staffChannelId && req.staffMessageId) {
      try {
        const staffChannel = await interaction.guild.channels.fetch(req.staffChannelId);
        if (staffChannel && staffChannel.isTextBased()) {
          const staffMsg = await staffChannel.messages.fetch(req.staffMessageId);
          if (staffMsg) {
            const updatedStaffEmbed = EmbedBuilder.from(staffMsg.embeds[0])
              .setColor(0xef4444)
              .setTitle(`❌ Citizen Card Application DECLINED: ${req.fullName}`)
              .addFields(
                { name: 'Decision', value: `❌ **DECLINED** by <@${interaction.user.id}>`, inline: true },
                { name: 'Reason for Rejection', value: reason, inline: false }
              );

            const disabledRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('card_declined_btn')
                .setLabel(`Declined by @${interaction.user.username}`)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true)
                .setEmoji('❌')
            );

            await staffMsg.edit({ embeds: [updatedStaffEmbed], components: [disabledRow] });
          }
        }
      } catch (staffEditErr) {
        console.warn('[UOI Bot] Error editing staff decline message:', staffEditErr.message);
      }
    }

    // Send decline notice to delivery channel or notify citizen
    try {
      let targetDeliveryChan = null;
      if (guildConfig?.deliveryChannelId) {
        targetDeliveryChan = await interaction.guild.channels.fetch(guildConfig.deliveryChannelId);
      }
      if (targetDeliveryChan && targetDeliveryChan.isTextBased()) {
        const declineNotificationEmbed = new EmbedBuilder()
          .setTitle('🚨 UOI Citizen Card Application Declined')
          .setColor(0xef4444)
          .setDescription(`Application update for <@${req.targetUser.id}>`)
          .addFields(
            { name: 'Applicant', value: `<@${req.targetUser.id}>`, inline: true },
            { name: 'Request ID', value: `\`${req.id}\``, inline: true },
            { name: 'Reviewing Officer', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Reason for Rejection', value: reason },
            {
              name: 'Next Steps',
              value: 'The citizen may submit a corrected application using `/card generate` once the stated issue is resolved.',
            }
          )
          .setFooter({ text: 'Union of Indians Staff Review System' })
          .setTimestamp();

        await targetDeliveryChan.send({ content: `<@${req.targetUser.id}>`, embeds: [declineNotificationEmbed] });
      }
    } catch (_) {}

    return interaction.editReply({
      content: `❌ **Card Application Declined.**\nRequest \`${requestId}\` marked as DECLINED with reason: "${reason}".`,
    });
  },
};

export default cardCommand;
