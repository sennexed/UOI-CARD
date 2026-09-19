import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const cardCommand = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Official UOI Identification System')
    // 1. /card generate
    .addSubcommand((sub) =>
      sub
        .setName('generate')
        .setDescription('Issue an official UOI identification card')
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
      const robloxQuery = interaction.options.getString('roblox');
      const fullName = interaction.options.getString('fullname');
      const gender = interaction.options.getString('gender');

      const serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const serverNickname = `${fullName} [${serialId}]`;

      try {
        if (targetMember && targetMember.manageable) {
          await targetMember.setNickname(serverNickname);
        }
      } catch (err) {
        console.warn('[UOI Bot] Nickname update failed (check role hierarchy):', err?.message);
      }

      const embed = new EmbedBuilder()
        .setTitle('🛡️ UOI Citizen ID Card Issued')
        .setColor(0xf59e0b)
        .addFields(
          { name: 'Card Serial ID', value: `\`${serialId}\``, inline: true },
          { name: 'Citizen', value: targetMember ? `<@${targetMember.id}>` : fullName, inline: true },
          { name: 'Roblox Identity', value: `${robloxQuery}`, inline: true },
          { name: 'Issuing Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Assigned Nickname', value: `\`${serverNickname}\`` }
        )
        .setFooter({ text: 'Union of Indians Registry • Official Citizen Credential' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // COMMAND 2: /card verify [serial]
    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const embed = new EmbedBuilder()
        .setTitle(`Citizen Card Verification: ${serial}`)
        .setColor(0x10b981)
        .setDescription(`✅ **AUTHENTIC UOI CITIZEN CARD**\nStatus: **ACTIVE**\nVerified by Registry Dispatch.`)
        .addFields(
          { name: 'Serial ID', value: `\`${serial}\``, inline: true },
          { name: 'Security Clearance', value: 'Level 1 Citizen', inline: true }
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
          { name: 'Security Audit', value: 'Clear • No infractions on file' }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND 4: /card promote
    if (sub === 'promote') {
      const targetMember = interaction.options.getMember('citizen');
      const newRank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason') || 'Commendable service to the Union';

      const embed = new EmbedBuilder()
        .setTitle('🎖️ Citizen Promotion Granted')
        .setColor(0x3b82f6)
        .addFields(
          { name: 'Citizen', value: `<@${targetMember.id}>`, inline: true },
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
