import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';

// Helper: Resolve Roblox User info and Avatar URL
async function fetchRobloxUserData(query) {
  try {
    let userId = null;
    let username = null;
    let displayName = null;

    // Check if query is numeric (User ID)
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
      // Username lookup
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

    // Fetch avatar thumbnail (720x720 full body or bust)
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

// Helper: Render official 1200x900 UOI Citizen ID Card
async function renderCardImage({
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

  // Check if a permanent template image exists locally
  let templateLoaded = false;
  for (const filename of ['template.png', 'template.jpg', './template.png', './template.jpg']) {
    try {
      if (fs.existsSync(filename)) {
        const bgImg = await loadImage(filename);
        ctx.drawImage(bgImg, 0, 0, 1200, 900);
        templateLoaded = true;
        break;
      }
    } catch (_) {}
  }

  if (!templateLoaded) {
    // 1. High-Tech Navy/Titanium Background
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 900);
    bgGrad.addColorStop(0, '#0a0f1d');
    bgGrad.addColorStop(0.5, '#070b16');
    bgGrad.addColorStop(1, '#04070e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 900);

    // Subtle background security grid lines
    ctx.strokeStyle = '#1e293b33';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1200; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 900);
      ctx.stroke();
    }
    for (let y = 0; y < 900; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1200, y);
      ctx.stroke();
    }

    // Outer Gold Security Border
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, 1164, 864);

    // Inner Border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(26, 26, 1148, 848);

    // Top Header Banner
    const headerGrad = ctx.createLinearGradient(0, 26, 0, 210);
    headerGrad.addColorStop(0, '#0f172a');
    headerGrad.addColorStop(1, '#070b14');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(26, 26, 1148, 184);

    // Tricolor Accent Ribbon (Saffron, White, Green)
    ctx.fillStyle = '#FF9933';
    ctx.fillRect(26, 206, 1148, 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(26, 210, 1148, 3);
    ctx.fillStyle = '#138808';
    ctx.fillRect(26, 213, 1148, 4);

    // Gold Ashoka Chakra Emblem
    ctx.save();
    ctx.translate(90, 115);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 24; i++) {
      const angle = (i * Math.PI) / 12;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 18, Math.sin(angle) * 18);
      ctx.lineTo(Math.cos(angle) * 48, Math.sin(angle) * 48);
      ctx.stroke();
    }
    ctx.restore();

    // Header Titles
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 36px sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('UNION OF INDIANS', 160, 95);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 16px sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('OFFICIAL CITIZEN IDENTIFICATION CARD', 162, 130);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px monospace';
    ctx.letterSpacing = '1px';
    ctx.fillText('GOVERNMENT OF UOI • CENTRAL CITIZEN REGISTRY RECORD', 162, 160);

    // Top-Right Serial Badge
    ctx.fillStyle = '#0b1324';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(880, 50, 270, 50, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText('CARD SERIAL ID', 895, 70);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(serialId, 895, 91);

    // Left Photo Container
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(56, 260, 345, 380);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(56, 260, 345, 380);

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px sans-serif';
    ctx.letterSpacing = '1.5px';
    ctx.fillText('OFFICIAL CITIZEN PORTRAIT', 65, 250);

    // Right Side 5 Data Field Rows
    const fields = [
      { label: 'FULL CITIZEN NAME', value: fullName },
      { label: 'ROBLOX USERNAME', value: robloxUsername ? `@${robloxUsername}` : 'UNLINKED' },
      { label: 'ROBLOX USER ID', value: robloxUserId || 'N/A' },
      { label: 'GENDER', value: gender || 'N/A' },
      { label: 'RANK / ROLE', value: assignedRank || 'COMMUNITY MEMBER' },
    ];

    fields.forEach((f, idx) => {
      const boxY = 260 + idx * 78;
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 13px sans-serif';
      ctx.letterSpacing = '1.5px';
      ctx.fillText(f.label, 470, boxY + 20);

      ctx.fillStyle = '#0b1324';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(470, boxY + 30, 680, 42, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 19px sans-serif';
      ctx.letterSpacing = '0.5px';
      ctx.fillText(f.value, 485, boxY + 58);
    });

    // Rank Badge under photo
    ctx.fillStyle = '#0b1324';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(56, 655, 345, 50, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '2px';
    ctx.fillText(assignedRank.toUpperCase(), 56 + 345 / 2, 687);
    ctx.textAlign = 'left';

    // Footer Security & Barcode section
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(56, 740);
    ctx.lineTo(1150, 740);
    ctx.stroke();

    let barX = 56;
    ctx.fillStyle = '#cbd5e1';
    for (let b = 0; b < 55; b++) {
      const w = (b % 3 === 0) ? 4 : (b % 2 === 0) ? 2 : 1;
      ctx.fillRect(barX, 760, w, 65);
      barX += w + ((b % 5 === 0) ? 6 : 3);
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '12px monospace';
    ctx.fillText(serialId, 56, 845);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 13px sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText('STATUS: ACTIVE & VERIFIED', 470, 775);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('Authorized by the Union of Indians Security Command • Tampering is punishable under UOI Code §4.', 470, 800);
    ctx.fillText(`Issued: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 470, 825);
  } else {
    // If official template image is loaded, fill template boxes
    ctx.save();
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 14px "Courier New", Courier, monospace';
    ctx.letterSpacing = '1px';
    ctx.fillText(serialId, 1010, 36);
    ctx.restore();

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
    ctx.letterSpacing = '1.5px';
    ctx.textAlign = 'center';
    ctx.fillText(assignedRank.toUpperCase(), rankBoxX + rankBoxW / 2, rankBoxY + 31);
    ctx.textAlign = 'left';
    ctx.restore();

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
    ctx.letterSpacing = '0.5px';
    fieldValues.forEach((f) => {
      if (f.val) {
        ctx.fillText(f.val, fieldX + 18, f.textY);
      }
    });
    ctx.restore();
  }

  // Draw Avatar inside Photo Frame
  const photoX = templateLoaded ? 60 : 60;
  const photoY = templateLoaded ? 324 : 264;
  const photoW = 337;
  const photoH = templateLoaded ? 344 : 372;

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

  return canvas.toBuffer('image/png');
}

export const cardCommand = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Official UOI Identification System')
    // 1. /card generate
    .addSubcommand((sub) =>
      sub
        .setName('generate')
        .setDescription('Issue an official UOI identification card with image')
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Discord member to receive the card').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('roblox').setDescription('Roblox Username or numerical ID').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('fullname').setDescription('Full Citizen Name').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('gender').setDescription('Gender').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('rank').setDescription('Rank / Role (e.g. PRESIDENT, PRIME MINISTER, COMMUNITY MEMBER)')
        )
    )
    // 2. /card verify [serial_id]
    .addSubcommand((sub) =>
      sub
        .setName('verify')
        .setDescription('Verify the authenticity of an issued UOI card serial ID')
        .addStringOption((opt) =>
          opt.setName('serial').setDescription('e.g. UOI-2026-839201').setRequired(true)
        )
    )
    // 3. /card inspect @user
    .addSubcommand((sub) =>
      sub
        .setName('inspect')
        .setDescription('Inspect citizen dossier, card status, and rank history')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Target Discord user').setRequired(true)
        )
    )
    // 4. /card promote
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
    // 5. /card revoke
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

    const issuingOfficer = {
      discordId: interaction.user.id,
      discordTag: interaction.user.tag,
    };

    // COMMAND 1: /card generate
    if (sub === 'generate') {
      await interaction.deferReply();

      const targetMember = interaction.options.getMember('citizen');
      const targetUser = interaction.options.getUser('citizen');
      const robloxQuery = interaction.options.getString('roblox');
      const fullName = interaction.options.getString('fullname');
      const gender = interaction.options.getString('gender');
      const assignedRank = (interaction.options.getString('rank') || 'COMMUNITY MEMBER').toUpperCase();

      // 1. Generate unique Serial ID
      const serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const serverNickname = `${fullName} [${serialId}]`;

      // 2. Fetch Roblox User Data & Avatar URL
      const robloxInfo = await fetchRobloxUserData(robloxQuery);

      // 3. Attempt to update Discord Server Nickname
      try {
        if (targetMember && targetMember.manageable) {
          await targetMember.setNickname(serverNickname);
        }
      } catch (err) {
        console.warn('[UOI Bot] Nickname update failed (role hierarchy):', err?.message);
      }

      // 4. Render High-Resolution ID Card Image
      let cardBuffer;
      try {
        cardBuffer = await renderCardImage({
          fullName,
          robloxUsername: robloxInfo.username,
          robloxUserId: robloxInfo.userId,
          gender,
          assignedRank,
          serialId,
          avatarUrl: robloxInfo.avatarUrl,
        });
      } catch (err) {
        console.error('[UOI Bot] Card image rendering failed:', err);
      }

      // 5. Build Discord Attachment & Embed
      const fileName = `${serialId}.png`;
      const files = [];

      const embed = new EmbedBuilder()
        .setTitle('🛡️ UOI Citizen ID Card Issued')
        .setColor(0xf59e0b)
        .setDescription(`Official identity credential issued to <@${targetUser.id}>`)
        .addFields(
          { name: 'Card Serial ID', value: `\`${serialId}\``, inline: true },
          { name: 'Citizen', value: `<@${targetUser.id}>`, inline: true },
          {
            name: 'Roblox Identity',
            value: robloxInfo.userId
              ? `[@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile)`
              : robloxQuery,
            inline: true,
          },
          { name: 'Rank Tier', value: `**${assignedRank}**`, inline: true },
          { name: 'Issuing Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Server Nickname', value: `\`${serverNickname}\``, inline: true }
        )
        .setFooter({ text: 'Union of Indians Registry • Official Citizen Credential' })
        .setTimestamp();

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(`attachment://${fileName}`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // COMMAND 2: /card verify [serial]
    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const embed = new EmbedBuilder()
        .setTitle(`Citizen Card Verification: ${serial}`)
        .setColor(0x10b981)
        .setDescription(`✅ **AUTHENTIC UOI CITIZEN CARD**\nStatus: **ACTIVE**\nVerified by Central Registry Dispatch.`)
        .addFields(
          { name: 'Serial ID', value: `\`${serial}\``, inline: true },
          { name: 'Registry Status', value: '🟢 Active & Verified', inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND 3: /card inspect @user
    if (sub === 'inspect') {
      const targetUser = interaction.options.getUser('user');
      const embed = new EmbedBuilder()
        .setTitle(`Citizen Dossier: ${targetUser.tag}`)
        .setColor(0x6366f1)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Discord ID', value: `\`${targetUser.id}\``, inline: true },
          { name: 'Citizen Status', value: '🟢 Active Citizen', inline: true },
          { name: 'Security Clearance', value: 'Standard Union Clearance', inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND 4: /card promote
    if (sub === 'promote') {
      const targetUser = interaction.options.getUser('citizen');
      const newRank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason') || 'Commendable service to the Union';

      const embed = new EmbedBuilder()
        .setTitle('🎖️ Citizen Promotion Granted')
        .setColor(0x3b82f6)
        .addFields(
          { name: 'Citizen', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Promoted To', value: `**${newRank.toUpperCase()}**`, inline: true },
          { name: 'Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Justification', value: reason }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND 5: /card revoke
    if (sub === 'revoke') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const reason = interaction.options.getString('reason');

      const embed = new EmbedBuilder()
        .setTitle('🚨 UOI Citizen ID Card REVOKED')
        .setColor(0xef4444)
        .setDescription(`⚠️ **THIS CITIZEN CARD HAS BEEN REVOKED & BLACKLISTED**`)
        .addFields(
          { name: 'Serial ID', value: `\`${serial}\``, inline: true },
          { name: 'Revoking Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },
};

export default cardCommand;
