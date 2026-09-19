export const discordJsCode = `// ==========================================
// UNION OF INDIANS (UOI) DISCORD.JS COMMAND HANDLERS
// WITH PERSISTENT JSON DATABASE & PER-SERVER TEMPLATES
// ==========================================

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// 1. Persistent Storage (Zero-dependency JSON DB & Server Template Storage)
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
      return parsed;
    }
  } catch (err) {
    console.error('[UOI Bot] Error loading database:', err.message);
  }
  return { cards: {}, serToUser: {} };
}

function saveDatabase(db) {
  ensureDirectories();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[UOI Bot] Error saving database:', err.message);
  }
}

// 2. Fetch Roblox user details & 720x720 avatar thumbnail
async function fetchRobloxUserData(query) {
  try {
    let userId = null;
    let username = null;
    let displayName = null;

    if (/^\\d+$/.test(query.trim())) {
      userId = parseInt(query.trim(), 10);
      try {
        const uResp = await fetch(\`https://users.roblox.com/v1/users/\${userId}\`);
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
      \`https://thumbnails.roblox.com/v1/users/avatar?userIds=\${userId}&size=720x720&format=Png&isCircular=false\`
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
    console.warn('[UOI Bot] Roblox user fetch warning:', err.message);
    return { userId: null, username: query, avatarUrl: null };
  }
}

// 3. Resolve Template Image (Strictly 1 template per server)
async function resolveTemplateImage(guildId) {
  ensureDirectories();

  // Check server-specific template (1 template per server)
  if (guildId) {
    for (const ext of ['png', 'jpg', 'jpeg']) {
      const sp = path.join(TEMPLATES_DIR, \`\${guildId}.\${ext}\`);
      if (fs.existsSync(sp)) {
        try {
          const img = await loadImage(sp);
          return { img, source: \`Server Template (\${guildId})\` };
        } catch (_) {}
      }
    }
  }

  // Global fallback candidates
  for (const filename of ['template.png', 'template.jpg', './template.png', './template.jpg', 'public/template.png']) {
    try {
      if (fs.existsSync(filename)) {
        const img = await loadImage(filename);
        return { img, source: filename };
      }
    } catch (_) {}
  }

  // TEMPLATE_URL env variable check
  const envUrl = process.env.TEMPLATE_URL || process.env.CARD_TEMPLATE_URL;
  if (envUrl) {
    try {
      const resp = await fetch(envUrl);
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync('template.png', buffer);
        const img = await loadImage(buffer);
        return { img, source: 'TEMPLATE_URL (saved as template.png)' };
      }
    } catch (_) {}
  }

  return { img: null, source: null };
}

// 4. Render 1200x900 High-Resolution Citizen ID Card
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
  const canvas = createCanvas(1200, 900);
  const ctx = canvas.getContext('2d');

  const { img: templateImg, source: templateSource } = await resolveTemplateImage(guildId);
  const templateLoaded = !!templateImg;

  if (templateLoaded) {
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
      { val: robloxUsername ? \`@\${robloxUsername}\` : '', textY: 446 },
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
      } catch (_) {}
    }
  } else {
    // Fallback graphics
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
      { label: 'ROBLOX USERNAME', value: robloxUsername ? \`@\${robloxUsername}\` : 'UNLINKED' },
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Official UOI Identification System')
    // 1. /card generate (1 card per citizen)
    .addSubcommand(sub =>
      sub.setName('generate')
        .setDescription('Issue an official UOI identification card (1 card per citizen)')
        .addUserOption(opt => opt.setName('citizen').setDescription('Discord member to receive the card').setRequired(true))
        .addStringOption(opt => opt.setName('roblox').setDescription('Roblox Username or numerical ID').setRequired(true))
        .addStringOption(opt => opt.setName('fullname').setDescription('Full Citizen Name').setRequired(true))
        .addStringOption(opt =>
          opt.setName('gender')
            .setDescription('Select citizen gender')
            .setRequired(true)
            .addChoices(
              { name: 'Male', value: 'Male' },
              { name: 'Female', value: 'Female' },
              { name: 'Other', value: 'Other' }
            )
        )
        .addStringOption(opt =>
          opt.setName('rank')
            .setDescription('Rank / Role tier (only shows roles this citizen possesses)')
            .setAutocomplete(true)
        )
    )
    // 2. /card show (NEW: View card from database)
    .addSubcommand(sub =>
      sub.setName('show')
        .setDescription('Display an official UOI ID card from the database')
        .addUserOption(opt => opt.setName('citizen').setDescription('Target member to view (leave empty to view your own card)'))
    )
    // 3. /card set-template (1 template per server)
    .addSubcommand(sub =>
      sub.setName('set-template')
        .setDescription('Upload or update this server\\\'s official card template (1 per server)')
        .addAttachmentOption(opt => opt.setName('image').setDescription('Attach the official template PNG/JPG'))
        .addStringOption(opt => opt.setName('url').setDescription('Or paste a direct image URL'))
    )
    // 4. /card view-template
    .addSubcommand(sub =>
      sub.setName('view-template')
        .setDescription('View the current active card template for this server')
    )
    // 5. /card verify [serial_id]
    .addSubcommand(sub =>
      sub.setName('verify')
        .setDescription('Verify the authenticity of an issued UOI card serial ID in database')
        .addStringOption(opt => opt.setName('serial').setDescription('e.g. UOI-2026-839201').setRequired(true))
    )
    // 6. /card inspect @user
    .addSubcommand(sub =>
      sub.setName('inspect')
        .setDescription('Inspect citizen dossier, card status, and rank history')
        .addUserOption(opt => opt.setName('user').setDescription('Target Discord user').setRequired(true))
    )
    // 7. /card promote
    .addSubcommand(sub =>
      sub.setName('promote')
        .setDescription('Promote a citizen to a new rank tier (Officer Only)')
        .addUserOption(opt => opt.setName('citizen').setDescription('Target member').setRequired(true))
        .addStringOption(opt =>
          opt.setName('rank')
            .setDescription('Target rank tier (server roles)')
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addStringOption(opt => opt.setName('reason').setDescription('Promotion justification'))
    )
    // 8. /card revoke
    .addSubcommand(sub =>
      sub.setName('revoke')
        .setDescription('Revoke a citizen ID card (Security Command Only)')
        .addStringOption(opt => opt.setName('serial').setDescription('Serial ID to revoke').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for revocation').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const issuingOfficer = {
      discordId: interaction.user.id,
      discordTag: interaction.user.tag,
    };

    // COMMAND: /card set-template (1 template per server)
    if (sub === 'set-template') {
      await interaction.deferReply({ ephemeral: false });

      if (interaction.member && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only members with \`Manage Server\` permission can configure this server\\\'s official card template.',
        });
      }

      const attachment = interaction.options.getAttachment('image');
      const urlInput = interaction.options.getString('url');
      const downloadUrl = attachment ? attachment.url : urlInput ? urlInput.trim() : null;

      if (!downloadUrl) {
        return interaction.editReply({
          content: '❌ **Please attach an image** or provide a direct image \`url\` when running \`/card set-template\`.',
        });
      }

      try {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) return interaction.editReply({ content: \`❌ Could not download image (HTTP \${resp.status}).\` });

        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const testImg = await loadImage(buffer);

        ensureDirectories();

        // Enforce 1 template per server
        if (guildId) {
          for (const ext of ['png', 'jpg', 'jpeg']) {
            const oldPath = path.join(TEMPLATES_DIR, \`\${guildId}.\${ext}\`);
            if (fs.existsSync(oldPath)) {
              try { fs.unlinkSync(oldPath); } catch (_) {}
            }
          }
          fs.writeFileSync(path.join(TEMPLATES_DIR, \`\${guildId}.png\`), buffer);
        }

        fs.writeFileSync('template.png', buffer);
        try {
          if (!fs.existsSync('public')) fs.mkdirSync('public');
          fs.writeFileSync('public/template.png', buffer);
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setTitle('✅ Official Server Template Saved')
          .setColor(0x10B981)
          .setDescription(\`Successfully set the active template for **\${interaction.guild ? interaction.guild.name : 'this server'}** (\`\${testImg.width}×\${testImg.height}px\`).\\n🔒 **Policy Enforced:** Exactly **1 template per server**.\\nAll cards generated or viewed with \`/card show\` in this server will stamp directly onto this official template!\`)
          .addFields(
            { name: 'Server ID', value: \`\`\${guildId || 'Global'}\`\`, inline: true },
            { name: 'Storage Slot', value: guildId ? \`templates/\${guildId}.png\` : 'template.png', inline: true }
          )
          .setFooter({ text: 'Union of Indians Registry • 1 Template Per Server' })
          .setTimestamp();

        const file = new AttachmentBuilder(buffer, { name: 'server-template.png' });
        embed.setImage('attachment://server-template.png');
        return interaction.editReply({ embeds: [embed], files: [file] });
      } catch (err) {
        return interaction.editReply({ content: \`❌ **Failed to save template:** \${err.message}\` });
      }
    }

    // COMMAND: /card view-template
    if (sub === 'view-template') {
      await interaction.deferReply({ ephemeral: true });
      const { img, source } = await resolveTemplateImage(guildId);
      if (!img) {
        return interaction.editReply({
          content: '⚠️ **No template found for this server!**\\nRun \`/card set-template\` with your template image attached to configure one.',
        });
      }
      let fileBuffer = null;
      if (guildId && fs.existsSync(path.join(TEMPLATES_DIR, \`\${guildId}.png\`))) {
        fileBuffer = fs.readFileSync(path.join(TEMPLATES_DIR, \`\${guildId}.png\`));
      } else {
        for (const f of ['template.png', 'template.jpg', 'public/template.png']) {
          if (fs.existsSync(f)) {
            fileBuffer = fs.readFileSync(f);
            break;
          }
        }
      }
      if (!fileBuffer) {
        return interaction.editReply({ content: \`Active template loaded from: \`\${source}\` (\${img.width}×\${img.height}px)\` });
      }
      const file = new AttachmentBuilder(fileBuffer, { name: 'active-template.png' });
      const embed = new EmbedBuilder()
        .setTitle('🖼️ Active Server Card Template')
        .setColor(0x3B82F6)
        .setDescription(\`Active template for **\${interaction.guild ? interaction.guild.name : 'this server'}**:\\n• Source: \`\${source}\`\\n• Resolution: **\${img.width}×\${img.height}px**\`)
        .setImage('attachment://active-template.png');
      return interaction.editReply({ embeds: [embed], files: [file] });
    }

    // COMMAND: /card show (Pull card from database)
    if (sub === 'show') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen') || interaction.user;

      const db = loadDatabase();
      const card = db.cards[targetUser.id];

      if (!card || card.status === 'REVOKED') {
        const embed = new EmbedBuilder()
          .setTitle('🔍 UOI Central Registry Search')
          .setColor(0xEF4444)
          .setDescription(\`No active UOI Citizen ID Card found in the database for <@\${targetUser.id}>.\`)
          .addFields(
            { name: 'Target Citizen', value: \`<@\${targetUser.id}> (\`\${targetUser.tag}\`)\`, inline: true },
            { name: 'Registry Status', value: card?.status === 'REVOKED' ? '🔴 REVOKED' : '⚪ Unregistered', inline: true },
            { name: 'Issuance Protocol', value: 'An authorized officer can issue a card using \`/card generate\`.' }
          )
          .setFooter({ text: 'Union of Indians Central Registry Database' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

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

      const fileName = \`\${card.serialId}.png\`;
      const files = [];

      const embed = new EmbedBuilder()
        .setTitle(\`🛡️ UOI Citizen ID Card: \${card.fullName}\`)
        .setColor(0x10B981)
        .setDescription(\`Official identity credential retrieved from database for <@\${card.discordId}>\`)
        .addFields(
          { name: 'Card Serial ID', value: \`\`\${card.serialId}\`\`, inline: true },
          { name: 'Citizen', value: \`<@\${card.discordId}>\`, inline: true },
          {
            name: 'Roblox Identity',
            value: card.robloxUserId
              ? \`[@\${card.robloxUsername}](https://www.roblox.com/users/\${card.robloxUserId}/profile)\`
              : \`@\${card.robloxUsername || 'Unlinked'}\`,
            inline: true,
          },
          { name: 'Rank Tier', value: \`**\${card.assignedRank}**\`, inline: true },
          { name: 'Gender', value: card.gender || 'N/A', inline: true },
          { name: 'Issuing Officer', value: \`<@\${card.issuedBy?.discordId || card.issuedBy}>\`, inline: true },
          {
            name: 'Issued Date',
            value: \`<t:\${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:f>\`,
            inline: true,
          },
          { name: 'Registry Status', value: '🟢 ACTIVE & VERIFIED', inline: true }
        )
        .setFooter({
          text: usedTemplate
            ? \`Central Database Record • Stamped with \${templateSource}\`
            : 'Central Database Record • Union of Indians',
        })
        .setTimestamp();

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(\`attachment://\${fileName}\`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // COMMAND 1: /card generate (1 card per person)
    if (sub === 'generate') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen');
      let targetMember = interaction.options.getMember('citizen');
      if (!targetMember && interaction.guild && targetUser) {
        targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      }
      const robloxQuery = interaction.options.getString('roblox');
      const fullName = interaction.options.getString('fullname');
      const gender = interaction.options.getString('gender') || 'Other';
      
      // Strict Role Check: only allow roles that this particular citizen possesses
      let requestedRank = interaction.options.getString('rank');
      let assignedRank = 'COMMUNITY MEMBER';

      if (targetMember && targetMember.roles) {
        const memberRoles = targetMember.roles.cache
          .filter(r => r.id !== interaction.guild.id && !r.managed)
          .sort((a, b) => b.position - a.position);

        if (!requestedRank) {
          // Default automatically to the highest server role this citizen possesses
          const topRole = memberRoles.first();
          assignedRank = topRole ? topRole.name.toUpperCase() : 'COMMUNITY MEMBER';
        } else {
          requestedRank = requestedRank.trim().toUpperCase();
          const hasRole = memberRoles.some(r => r.name.toUpperCase() === requestedRank);
          if (!hasRole && requestedRank !== 'COMMUNITY MEMBER') {
            return interaction.editReply({
              content: \`⚠️ **Role Assignment Error**: <@\${targetUser.id}> does not hold the role **\${requestedRank}** in this server!\\\\nUnder Union security policy, the rank option is strictly restricted to roles this citizen actually possesses.\`,
            });
          }
          assignedRank = requestedRank;
        }
      } else {
        assignedRank = (requestedRank || 'COMMUNITY MEMBER').toUpperCase();
      }

      // STRICT RULE: Only 1 card per person
      const db = loadDatabase();
      const existingCard = db.cards[targetUser.id];
      if (existingCard && existingCard.status === 'ACTIVE') {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Card Generation Blocked: 1 Card Per Person')
          .setColor(0xF59E0B)
          .setDescription(
            \`**<@\${targetUser.id}> already possesses an active UOI Citizen Card!**\\n\` +
            \`Under Union regulations, each citizen is restricted to exactly **one card**.\`
          )
          .addFields(
            { name: 'Existing Serial ID', value: \`\`\${existingCard.serialId}\`\`, inline: true },
            { name: 'Full Name', value: existingCard.fullName, inline: true },
            { name: 'Current Rank', value: \`**\${existingCard.assignedRank}**\`, inline: true },
            { name: 'Roblox Username', value: \`@\${existingCard.robloxUsername || 'Unlinked'}\`, inline: true },
            { name: 'Status', value: '🟢 ACTIVE CITIZEN', inline: true },
            {
              name: 'Issued On',
              value: \`<t:\${Math.floor(new Date(existingCard.issuedAt).getTime() / 1000)}:R>\`,
              inline: true,
            }
          )
          .addFields({
            name: '📋 What to do?',
            value:
              \`• Run \`/card show citizen:@\${targetUser.username}\` to view their existing registered card.\\n\` +
              \`• Use \`/card promote\` to upgrade their rank.\\n\` +
              \`• If the previous card was lost, an authorized officer must run \`/card revoke serial:\${existingCard.serialId}\` before re-issuing.\`,
          })
          .setFooter({ text: 'Union of Indians Registry • Strict Single-Card Enforcement' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      const serialId = \`UOI-\${new Date().getFullYear()}-\${Math.floor(100000 + Math.random() * 900000)}\`;
      const serverNickname = \`\${fullName} [\${serialId}]\`;

      const robloxInfo = await fetchRobloxUserData(robloxQuery);

      try {
        if (targetMember && targetMember.manageable) {
          await targetMember.setNickname(serverNickname);
        }
      } catch (err) {
        console.warn('[UOI Bot] Could not update nickname due to role hierarchy limits');
      }

      let cardBuffer = null;
      let usedTemplate = false;
      let templateSource = null;
      try {
        const renderResult = await renderCardImage({
          guildId,
          fullName,
          robloxUsername: robloxInfo.username,
          robloxUserId: robloxInfo.userId,
          gender,
          assignedRank,
          serialId,
          avatarUrl: robloxInfo.avatarUrl,
        });
        cardBuffer = renderResult.buffer;
        usedTemplate = renderResult.usedTemplate;
        templateSource = renderResult.source;
      } catch (err) {
        console.error('[UOI Bot] Failed to generate card image:', err);
      }

      // Save to persistent database (1 card per person)
      const newCardRecord = {
        discordId: targetUser.id,
        discordTag: targetUser.tag,
        guildId: guildId || null,
        serialId,
        fullName,
        robloxUsername: robloxInfo.username,
        robloxUserId: robloxInfo.userId,
        gender,
        assignedRank,
        avatarUrl: robloxInfo.avatarUrl,
        issuedBy: {
          discordId: issuingOfficer.discordId,
          discordTag: issuingOfficer.discordTag,
        },
        issuedAt: new Date().toISOString(),
        serverNickname,
        status: 'ACTIVE',
      };
      db.cards[targetUser.id] = newCardRecord;
      db.serToUser = db.serToUser || {};
      db.serToUser[serialId] = targetUser.id;
      saveDatabase(db);

      const fileName = \`\${serialId}.png\`;
      const files = [];

      const embed = new EmbedBuilder()
        .setTitle('🛡️ UOI Citizen ID Card Issued')
        .setColor(usedTemplate ? 0x10B981 : 0xF59E0B)
        .setDescription(\`Official identity credential issued to <@\${targetUser.id}>\`)
        .addFields(
          { name: 'Card Serial ID', value: \`\`\${serialId}\`\`, inline: true },
          { name: 'Citizen', value: \`<@\${targetUser.id}>\`, inline: true },
          {
            name: 'Roblox Identity',
            value: robloxInfo.userId ? \`[@\${robloxInfo.username}](https://www.roblox.com/users/\${robloxInfo.userId}/profile)\` : robloxQuery,
            inline: true,
          },
          { name: 'Rank Tier', value: \`**\${assignedRank}**\`, inline: true },
          { name: 'Issuing Officer', value: \`<@\${issuingOfficer.discordId}>\`, inline: true },
          { name: 'Server Nickname', value: \`\`\${serverNickname}\`\`, inline: true }
        )
        .setFooter({
          text: usedTemplate
            ? \`Saved to Database • Stamped with \${templateSource}\`
            : '⚠️ Permanent template missing! Type /card set-template to upload it.',
        })
        .setTimestamp();

      if (!usedTemplate) {
        embed.addFields({
          name: '⚠️ Template Notice',
          value: 'This server has not uploaded its official template yet. Run \`/card set-template\` with your image attached!',
        });
      }

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(\`attachment://\${fileName}\`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // COMMAND: /card verify [serial]
    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const db = loadDatabase();
      const userId = db.serToUser?.[serial];
      const card = userId ? db.cards[userId] : null;

      if (!card) {
        const embed = new EmbedBuilder()
          .setTitle(\`Citizen Card Verification: \${serial}\`)
          .setColor(0xEF4444)
          .setDescription(\`❌ **UNVERIFIED OR FRAUDULENT SERIAL ID**\\nSerial \`\${serial}\` was not found in the official UOI database.\`)
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      const isActive = card.status === 'ACTIVE';
      const embed = new EmbedBuilder()
        .setTitle(\`Citizen Card Verification: \${serial}\`)
        .setColor(isActive ? 0x10B981 : 0xEF4444)
        .setDescription(
          isActive
            ? \`✅ **AUTHENTIC UOI CITIZEN CARD**\\nStatus: **ACTIVE & VERIFIED**\\nRegistered in Central Registry.\`
            : \`🚨 **REVOKED CITIZEN CARD**\\nThis credential was revoked and is no longer valid.\`
        )
        .addFields(
          { name: 'Citizen', value: \`<@\${card.discordId}>\`, inline: true },
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Roblox', value: \`@\${card.robloxUsername || 'Unlinked'}\`, inline: true },
          { name: 'Rank Tier', value: \`**\${card.assignedRank}**\`, inline: true },
          { name: 'Issuing Officer', value: \`<@\${card.issuedBy?.discordId || card.issuedBy}>\`, inline: true },
          { name: 'Issued Date', value: \`<t:\${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:d>\`, inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND: /card inspect @user
    if (sub === 'inspect') {
      const targetUser = interaction.options.getUser('user');
      const db = loadDatabase();
      const card = db.cards[targetUser.id];

      const embed = new EmbedBuilder()
        .setTitle(\`Citizen Dossier: \${targetUser.tag}\`)
        .setColor(card?.status === 'ACTIVE' ? 0x6366F1 : 0x64748B)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Discord ID', value: \`\`\${targetUser.id}\`\`, inline: true },
          {
            name: 'Citizen Card Status',
            value: card?.status === 'ACTIVE' ? \`🟢 Active (\`\${card.serialId}\`)\` : card?.status === 'REVOKED' ? '🔴 Revoked' : '⚪ None Registered',
            inline: true,
          }
        );

      if (card) {
        embed.addFields(
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Roblox Username', value: \`@\${card.robloxUsername || 'Unlinked'}\`, inline: true },
          { name: 'Rank Tier', value: \`**\${card.assignedRank}**\`, inline: true },
          { name: 'Issued At', value: \`<t:\${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:f>\`, inline: true }
        );
      }

      embed.setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND: /card promote
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
        .setColor(0x3B82F6)
        .addFields(
          { name: 'Citizen', value: \`<@\${targetUser.id}>\`, inline: true },
          { name: 'Promoted To', value: \`**\${newRank}**\`, inline: true },
          { name: 'Officer', value: \`<@\${issuingOfficer.discordId}>\`, inline: true },
          { name: 'Justification', value: reason }
        )
        .setFooter({ text: card ? 'Database record updated' : 'Notice: No existing database card' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND: /card revoke
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
        .setColor(0xEF4444)
        .setDescription('⚠️ **THIS CITIZEN CARD HAS BEEN REVOKED & BLACKLISTED**')
        .addFields(
          { name: 'Serial ID', value: \`\`\${serial}\`\`, inline: true },
          { name: 'Revoking Officer', value: \`<@\${issuingOfficer.discordId}>\`, inline: true },
          { name: 'Reason', value: reason },
          { name: 'Re-issuance Status', value: 'Citizen slot has been released for fresh issuance if authorized.' }
        )
        .setFooter({ text: 'Database entry marked as REVOKED' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },

  /**
   * Autocomplete handler for /card options
   * Dynamically filters rank choices to ONLY the roles that this particular citizen possesses
   */
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'rank') {
      const sub = interaction.options.getSubcommand(false);
      let choices = [];

      if (sub === 'promote' && interaction.guild) {
        // For /card promote: show server roles to promote to
        const guildRoles = interaction.guild.roles.cache
          .filter(r => r.id !== interaction.guild.id && !r.managed)
          .sort((a, b) => b.position - a.position);
        choices = guildRoles.map(r => ({
          name: r.name,
          value: r.name.toUpperCase(),
        }));
      } else {
        // For /card generate: STRICT REQUIREMENT - Only show the roles that this particular person has
        const targetUserId = interaction.options.get('citizen')?.value;

        if (targetUserId && interaction.guild) {
          try {
            const member = interaction.guild.members.cache.get(targetUserId) ||
              await interaction.guild.members.fetch(targetUserId).catch(() => null);
            if (member && member.roles) {
              // STRICT REQUIREMENT: Only show the roles that this particular person has in the rank option
              const memberRoles = member.roles.cache
                .filter(r => r.id !== interaction.guild.id && !r.managed)
                .sort((a, b) => b.position - a.position);

              choices = memberRoles.map(r => ({
                name: r.name,
                value: r.name.toUpperCase(),
              }));
            }
          } catch (err) {
            console.warn('[UOI Bot] Failed to fetch citizen roles for autocomplete:', err.message);
          }
        }

        if (choices.length === 0) {
          if (!targetUserId) {
            choices = [{ name: '⚠️ Select the citizen option first to view their roles', value: 'COMMUNITY MEMBER' }];
          } else {
            choices = [{ name: 'COMMUNITY MEMBER (Default - No special roles held)', value: 'COMMUNITY MEMBER' }];
          }
        }
      }

      const filtered = choices
        .filter(choice => choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 25);

      await interaction.respond(filtered);
    }
  }
};`;
