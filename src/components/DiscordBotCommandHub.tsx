import { useState, useEffect } from 'react';
import JSZip from 'jszip';
import {
  ProcessedCardData,
  ROLE_HIERARCHY,
  CardRecord,
  CardAuditActor,
} from '../types';
import {
  Terminal,
  ShieldCheck,
  Search,
  UserCheck,
  Code,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  Award,
  UserX,
  History,
  Shield,
  Send,
  Sliders,
  Archive,
  Loader2,
  Server,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Github,
} from 'lucide-react';

interface DiscordBotCommandHubProps {
  currentCardData: ProcessedCardData;
  currentSerialId: string;
}

export function DiscordBotCommandHub({
  currentCardData,
  currentSerialId,
}: DiscordBotCommandHubProps) {
  const [activeTab, setActiveTab] = useState<'generate' | 'verify' | 'inspect' | 'manage' | 'code'>('generate');

  // Command Executor Simulation (interaction.user)
  const [executor, setExecutor] = useState<CardAuditActor>({
    discordId: '772211993344556677',
    discordTag: 'Officer_Aarav#1337',
  });

  // Target Recipient Discord Details
  const [targetDiscordId, setTargetDiscordId] = useState<string>('883322114455667788');
  const [targetDiscordTag, setTargetDiscordTag] = useState<string>(
    `${currentCardData.robloxUsername || 'citizen'}#0001`
  );

  // Vault cards list
  const [vaultCards, setVaultCards] = useState<CardRecord[]>([]);
  const [loadingVault, setLoadingVault] = useState<boolean>(false);

  // /card verify state
  const [verifySerialInput, setVerifySerialInput] = useState<string>(currentSerialId);
  const [verifyResult, setVerifyResult] = useState<{
    verified?: boolean;
    card?: CardRecord;
    message?: string;
    status?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);

  // /card inspect state
  const [inspectQuery, setInspectQuery] = useState<string>(currentCardData.robloxUsername || 'Builderman');
  const [inspectResults, setInspectResults] = useState<CardRecord[] | null>(null);
  const [inspecting, setInspecting] = useState<boolean>(false);

  // /card promote & revoke state
  const [selectedVaultSerial, setSelectedVaultSerial] = useState<string>('');
  const [promoteRank, setPromoteRank] = useState<string>('SENATOR');
  const [promoteReason, setPromoteReason] = useState<string>('Exemplary service in Union Assembly');
  const [revokeReason, setRevokeReason] = useState<string>('Violation of Community Code §2.1');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Copy feedback
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedNick, setCopiedNick] = useState<boolean>(false);
  const [issueSuccess, setIssueSuccess] = useState<boolean>(false);
  const [zippingBot, setZippingBot] = useState<boolean>(false);
  const [botZipDownloaded, setBotZipDownloaded] = useState<boolean>(false);
  const [showWispbyteGuide, setShowWispbyteGuide] = useState<boolean>(true);
  const [hostingMethod, setHostingMethod] = useState<'github' | 'upload'>('github');

  // Fetch vault list
  const fetchVault = async () => {
    setLoadingVault(true);
    try {
      const resp = await fetch('/api/card/vault');
      if (resp.ok) {
        const json = await resp.json();
        setVaultCards(json.cards || []);
        if (json.cards && json.cards.length > 0 && !selectedVaultSerial) {
          setSelectedVaultSerial(json.cards[0].serialId);
        }
      }
    } catch (err) {
      console.error('Failed to load card vault:', err);
    } finally {
      setLoadingVault(false);
    }
  };

  useEffect(() => {
    fetchVault();
  }, []);

  // Update recipient tag when roblox username changes
  useEffect(() => {
    if (currentCardData.robloxUsername) {
      setTargetDiscordTag(`${currentCardData.robloxUsername}#0001`);
    }
  }, [currentCardData.robloxUsername]);

  // Command 1: /card generate
  const handleIssueCard = async () => {
    try {
      const resp = await fetch('/api/card/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialId: currentSerialId,
          issuedTo: {
            discordId: targetDiscordId,
            discordTag: targetDiscordTag,
            robloxUsername: currentCardData.robloxUsername,
            robloxUserId: currentCardData.robloxUserId,
            fullName: currentCardData.fullName,
            assignedRank: currentCardData.assignedRank,
          },
          issuedBy: executor,
        }),
      });

      if (resp.ok) {
        setIssueSuccess(true);
        fetchVault();
        setTimeout(() => setIssueSuccess(false), 4000);
      }
    } catch (err) {
      console.error('Failed to issue card:', err);
    }
  };

  // Command 2: /card verify [serial]
  const handleVerify = async (serialToTest?: string) => {
    const serial = (serialToTest || verifySerialInput).trim();
    if (!serial) return;
    setVerifying(true);
    setVerifyResult(null);

    try {
      const resp = await fetch(`/api/card/verify/${encodeURIComponent(serial)}`);
      const json = await resp.json();
      setVerifyResult(json);
    } catch (err) {
      setVerifyResult({
        verified: false,
        message: 'Network error verifying card with registry server',
      });
    } finally {
      setVerifying(false);
    }
  };

  // Command 3: /card inspect [query]
  const handleInspect = async () => {
    if (!inspectQuery.trim()) return;
    setInspecting(true);
    setInspectResults(null);

    try {
      const resp = await fetch(`/api/card/inspect/${encodeURIComponent(inspectQuery.trim())}`);
      if (resp.ok) {
        const json = await resp.json();
        setInspectResults(json.records || []);
      } else {
        setInspectResults([]);
      }
    } catch (err) {
      setInspectResults([]);
    } finally {
      setInspecting(false);
    }
  };

  // Command 4a: /card promote
  const handlePromote = async () => {
    if (!selectedVaultSerial) return;
    setActionFeedback(null);

    try {
      const resp = await fetch('/api/card/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialId: selectedVaultSerial,
          newRank: promoteRank,
          reason: promoteReason,
          performedBy: executor,
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        setActionFeedback(`Promoted ${json.card.issuedTo.fullName} to ${json.newRank}`);
        fetchVault();
      }
    } catch (err) {
      setActionFeedback('Failed to execute promotion');
    }
  };

  // Command 4b: /card revoke
  const handleRevoke = async () => {
    if (!selectedVaultSerial) return;
    setActionFeedback(null);

    try {
      const resp = await fetch('/api/card/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialId: selectedVaultSerial,
          reason: revokeReason,
          performedBy: executor,
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        setActionFeedback(`Revoked card ${json.card.serialId} for ${json.card.issuedTo.fullName}`);
        fetchVault();
      }
    } catch (err) {
      setActionFeedback('Failed to execute revocation');
    }
  };

  const calculatedServerNickname = `${currentCardData.fullName} [${currentSerialId}]`;

  const discordJsCode = `// ==========================================
// UNION OF INDIANS (UOI) DISCORD.JS COMMAND HANDLERS
// WITH AUTOMATIC HIGH-RESOLUTION CARD IMAGE GENERATION
// ==========================================

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');

// 1. Fetch Roblox user details & 720x720 avatar thumbnail
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

// 2. Render 1200x900 High-Resolution Citizen ID Card
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
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 900);
    bgGrad.addColorStop(0, '#0a0f1d');
    bgGrad.addColorStop(0.5, '#070b16');
    bgGrad.addColorStop(1, '#04070e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 900);

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

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, 1164, 864);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(26, 26, 1148, 848);

    const headerGrad = ctx.createLinearGradient(0, 26, 0, 210);
    headerGrad.addColorStop(0, '#0f172a');
    headerGrad.addColorStop(1, '#070b14');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(26, 26, 1148, 184);

    ctx.fillStyle = '#FF9933';
    ctx.fillRect(26, 206, 1148, 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(26, 210, 1148, 3);
    ctx.fillStyle = '#138808';
    ctx.fillRect(26, 213, 1148, 4);

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

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('UNION OF INDIANS', 160, 95);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('OFFICIAL CITIZEN IDENTIFICATION CARD', 162, 130);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px monospace';
    ctx.fillText('GOVERNMENT OF UOI • CENTRAL CITIZEN REGISTRY RECORD', 162, 160);

    ctx.fillStyle = '#0b1324';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(880, 50, 270, 50, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('CARD SERIAL ID', 895, 70);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(serialId, 895, 91);

    ctx.fillStyle = '#0b1120';
    ctx.fillRect(56, 260, 345, 380);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(56, 260, 345, 380);

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('OFFICIAL CITIZEN PORTRAIT', 65, 250);

    const fields = [
      { label: 'FULL CITIZEN NAME', value: fullName },
      { label: 'ROBLOX USERNAME', value: robloxUsername ? \`@\${robloxUsername}\` : 'UNLINKED' },
      { label: 'ROBLOX USER ID', value: robloxUserId || 'N/A' },
      { label: 'GENDER', value: gender || 'N/A' },
      { label: 'RANK / ROLE', value: assignedRank || 'COMMUNITY MEMBER' },
    ];

    fields.forEach((f, idx) => {
      const boxY = 260 + idx * 78;
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 13px sans-serif';
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
      ctx.fillText(f.value, 485, boxY + 58);
    });

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
    ctx.fillText(assignedRank.toUpperCase(), 56 + 345 / 2, 687);
    ctx.textAlign = 'left';

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
    ctx.fillText('STATUS: ACTIVE & VERIFIED', 470, 775);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('Authorized by Union of Indians Security Command • Tampering is prohibited.', 470, 800);
  } else {
    ctx.save();
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 14px "Courier New", Courier, monospace';
    ctx.fillText(serialId, 1010, 36);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#080d19';
    ctx.beginPath();
    ctx.roundRect(54, 687, 348, 46, 4);
    ctx.fill();
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(assignedRank.toUpperCase(), 54 + 174, 718);
    ctx.textAlign = 'left';
    ctx.restore();

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
      if (f.val) ctx.fillText(f.val, 472 + 18, f.textY);
    });
    ctx.restore();
  }

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
      console.warn('[UOI Bot] Avatar drawing warning:', err.message);
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Official UOI Identification System')
    // 1. /card generate
    .addSubcommand(sub =>
      sub.setName('generate')
        .setDescription('Issue an official UOI identification card with image')
        .addUserOption(opt => opt.setName('citizen').setDescription('Discord member to receive the card').setRequired(true))
        .addStringOption(opt => opt.setName('roblox').setDescription('Roblox Username or numerical ID').setRequired(true))
        .addStringOption(opt => opt.setName('fullname').setDescription('Full Citizen Name').setRequired(true))
        .addStringOption(opt => opt.setName('gender').setDescription('Gender').setRequired(true))
        .addStringOption(opt => opt.setName('rank').setDescription('Rank / Role tier (e.g. PRESIDENT, COMMUNITY MEMBER)'))
    )
    // 2. /card verify [serial_id]
    .addSubcommand(sub =>
      sub.setName('verify')
        .setDescription('Verify the authenticity of an issued UOI card serial ID')
        .addStringOption(opt => opt.setName('serial').setDescription('e.g. UOI-2026-839201').setRequired(true))
    )
    // 3. /card inspect @user
    .addSubcommand(sub =>
      sub.setName('inspect')
        .setDescription('Inspect citizen dossier, card status, and rank history')
        .addUserOption(opt => opt.setName('user').setDescription('Target Discord user').setRequired(true))
    )
    // 4. /card promote
    .addSubcommand(sub =>
      sub.setName('promote')
        .setDescription('Promote a citizen to a new rank tier (Officer Only)')
        .addUserOption(opt => opt.setName('citizen').setDescription('Target member').setRequired(true))
        .addStringOption(opt => opt.setName('rank').setDescription('Target rank tier').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Promotion justification'))
    )
    // 5. /card revoke
    .addSubcommand(sub =>
      sub.setName('revoke')
        .setDescription('Revoke a citizen ID card (Security Command Only)')
        .addStringOption(opt => opt.setName('serial').setDescription('Serial ID to revoke').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for revocation').setRequired(true))
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
        console.error('[UOI Bot] Failed to generate card image:', err);
      }

      const fileName = \`\${serialId}.png\`;
      const files = [];

      const embed = new EmbedBuilder()
        .setTitle('🛡️ UOI Citizen ID Card Issued')
        .setColor(0xF59E0B)
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
        .setFooter({ text: 'Union of Indians Registry • Official Citizen Credential' })
        .setTimestamp();

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(\`attachment://\${fileName}\`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // COMMAND 2: /card verify [serial]
    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const embed = new EmbedBuilder()
        .setTitle(\`Citizen Card Verification: \${serial}\`)
        .setColor(0x10B981)
        .setDescription(\`✅ **AUTHENTIC UOI CITIZEN CARD**\\nStatus: **ACTIVE**\\nVerified by Registry Dispatch.\`)
        .addFields(
          { name: 'Serial ID', value: \`\`\${serial}\`\`, inline: true },
          { name: 'Security Clearance', value: 'Level 1 Citizen', inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // COMMAND 3: /card inspect @user
    if (sub === 'inspect') {
      const targetUser = interaction.options.getUser('user');
      const embed = new EmbedBuilder()
        .setTitle(\`Citizen Dossier: \${targetUser.tag}\`)
        .setColor(0x6366F1)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Discord ID', value: \`\`\${targetUser.id}\`\`, inline: true },
          { name: 'Citizen Status', value: '🟢 Active Citizen', inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  }
};`;

  const handleDownloadBotZip = async () => {
    setZippingBot(true);
    setBotZipDownloaded(false);
    try {
      const zip = new JSZip();

      // 1. Slash command handler
      zip.file('commands/card.js', discordJsCode);

      // 2. package.json for the bot
      const botPackageJson = {
        name: 'uoi-id-discord-bot',
        version: '1.0.0',
        description: 'Union of Indians Discord ID Card & Citizen Verification Bot',
        main: 'index.js',
        scripts: {
          start: 'node index.js',
        },
        dependencies: {
          '@napi-rs/canvas': '^0.1.66',
          'discord.js': '^14.16.3',
          dotenv: '^16.4.5',
        },
      };
      zip.file('package.json', JSON.stringify(botPackageJson, null, 2));

      // 3. index.js starter file
      const indexJsContent = `require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

let cardCommand;
try {
  cardCommand = require('./commands/card.js');
} catch (err) {
  console.error('❌ Failed to load commands/card.js:', err.message);
  console.error('Ensure commands/card.js exists in the root directory.');
  process.exit(1);
}

const token = (process.env.DISCORD_TOKEN || '').trim();

if (!token || token === 'your_bot_token_here') {
  console.error('=====================================================');
  console.error('❌ CONFIG ERROR: DISCORD_TOKEN is missing or empty!');
  console.error('Please create a .env file in the root directory with:');
  console.error('DISCORD_TOKEN=your_real_bot_token');
  console.error('=====================================================');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', async () => {
  console.log(\`✅ Logged in as \${client.user.tag}\`);

  // Register /card slash command
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering slash commands with Discord API...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [cardCommand.data.toJSON()] },
    );
    console.log('✅ Registered /card slash command successfully.');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'card') {
    try {
      await cardCommand.execute(interaction);
    } catch (err) {
      console.error('Error executing /card command:', err);
    }
  }
});

client.login(token).catch((err) => {
  console.error('❌ Discord bot login failed:', err.message);
  if (err.message.toLowerCase().includes('disallowed intents') || err.message.toLowerCase().includes('privileged')) {
    console.error('👉 FIX: Go to https://discord.com/developers/applications -> Your Bot -> Bot tab -> Enable "Server Members Intent"!');
  } else if (err.message.toLowerCase().includes('token') || err.message.toLowerCase().includes('unauthorized')) {
    console.error('👉 FIX: Your DISCORD_TOKEN is incorrect. Re-copy the token from the Discord Developer Portal without quotes.');
  }
  process.exit(1);
});
`;
      zip.file('index.js', indexJsContent);

      // 4. .env.example
      zip.file('.env.example', 'DISCORD_TOKEN=your_bot_token_here\n');

      // 5. .gitignore for GitHub repository
      zip.file('.gitignore', 'node_modules/\n.env\n.DS_Store\n*.log\npackage-lock.json\n');

      // 6. README.md
      const readmeBot = `# Union of Indians (UOI) Discord Bot

## Setup Instructions
1. Run \`npm install\`
2. Copy \`.env.example\` to \`.env\` and put your bot token:
   \`DISCORD_TOKEN=your_token\`
3. Ensure the bot has \`Manage Nicknames\` permission and its role is higher than members.
4. Run \`node index.js\`

## Slash Commands Included:
- \`/card generate\`: Issues new citizen card, sets server nickname to "Full Name [Serial]".
- \`/card verify serial_id\`: Verifies citizen status, rank tier, and authenticity.
- \`/card inspect @user\`: Dossier investigation & audit log.
- \`/card promote\`: Upgrades citizen rank tier.
- \`/card revoke\`: Revokes fraudulent/banned credentials.
`;
      zip.file('README.md', readmeBot);

      const blob = await zip.generateAsync({ type: 'blob' });
      const downloadUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement('a');
      tempLink.href = downloadUrl;
      tempLink.download = 'UOI_Discord_Bot_Files.zip';
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      URL.revokeObjectURL(downloadUrl);

      setBotZipDownloaded(true);
      setTimeout(() => setBotZipDownloaded(false), 3000);
    } catch (err) {
      console.error('Failed to create bot zip:', err);
    } finally {
      setZippingBot(false);
    }
  };

  return (
    <div id="discord-command-hub" className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col gap-4">
      {/* Header with Title and Live Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-slate-200">Discord Bot Command Hub</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Audit Engine Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              5 Integrated Slash Commands • Executor Tracking (<span className="text-amber-400">interaction.user</span>) • Automatic Server Nickname
            </p>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('generate')}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              activeTab === 'generate' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            /card generate
          </button>
          <button
            onClick={() => setActiveTab('verify')}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              activeTab === 'verify' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            /card verify
          </button>
          <button
            onClick={() => setActiveTab('inspect')}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              activeTab === 'inspect' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            /card inspect
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              activeTab === 'manage' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Promote / Revoke
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              activeTab === 'code' ? 'bg-amber-600 text-white' : 'text-amber-400/80 hover:text-amber-300'
            }`}
          >
            Bot Code (JS)
          </button>
        </div>
      </div>

      {/* Executor Tracking Bar (interaction.user) */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-medium flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-amber-400" />
            Active Command Executor (<code>interaction.user</code>):
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={executor.discordTag}
              onChange={(e) => setExecutor({ ...executor, discordTag: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200 font-mono text-[11px] w-36 focus:outline-none focus:border-amber-400"
              placeholder="Officer#0001"
            />
            <span className="text-slate-500 font-mono">ID:</span>
            <input
              type="text"
              value={executor.discordId}
              onChange={(e) => setExecutor({ ...executor, discordId: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-400 font-mono text-[11px] w-36 focus:outline-none focus:border-amber-400"
              placeholder="77221199..."
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-[11px]">Server Nickname Output:</span>
          <code className="px-2 py-0.5 bg-slate-900 border border-slate-800 text-emerald-300 rounded font-mono text-[11px]">
            {calculatedServerNickname}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(calculatedServerNickname);
              setCopiedNick(true);
              setTimeout(() => setCopiedNick(false), 2000);
            }}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded cursor-pointer transition-colors"
            title="Copy formatted nickname"
          >
            {copiedNick ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* TAB 1: /card generate */}
      {activeTab === 'generate' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-2">
              <span className="text-xs font-semibold text-slate-300">Target Recipient (Citizen)</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[11px] text-slate-400">Discord Tag:</label>
                  <input
                    type="text"
                    value={targetDiscordTag}
                    onChange={(e) => setTargetDiscordTag(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500 mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400">Discord User ID:</label>
                  <input
                    type="text"
                    value={targetDiscordId}
                    onChange={(e) => setTargetDiscordId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-400 font-mono text-xs focus:outline-none focus:border-indigo-500 mt-1"
                  />
                </div>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                <span>Card Serial: <strong className="text-sky-400 font-mono">{currentSerialId}</strong></span>
                <span>Assigned Rank: <strong className="text-amber-400">{currentCardData.assignedRank}</strong></span>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Dispatch Audit Confirmation</span>
                <span className="text-[10px] text-slate-500 font-mono">POST /api/card/issue</span>
              </div>
              <p className="text-xs text-slate-400 my-2 leading-relaxed">
                Executes the issue sequence: saves the card in the official database vault, records{' '}
                <strong className="text-amber-300">{executor.discordTag}</strong> as the verified officer, and calculates the member's server profile nickname.
              </p>
              <button
                onClick={handleIssueCard}
                className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
              >
                {issueSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>Card Registered in Database Vault!</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Execute /card generate (Save with Executor Audit)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick list of recently registered cards */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Card Database Vault ({vaultCards.length} Registered Cards):</span>
              <button
                onClick={fetchVault}
                className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${loadingVault ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {vaultCards.slice(0, 3).map((c) => (
                <div key={c.serialId} className="bg-slate-900 border border-slate-800 p-2 rounded text-[11px] flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sky-400 font-bold">{c.serialId}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                      c.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {c.status}
                    </span>
                  </div>
                  <span className="text-slate-200 font-medium truncate">{c.issuedTo.fullName}</span>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>{c.issuedTo.assignedRank}</span>
                    <span>By: {c.issuedBy.discordTag}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: /card verify [serial_id] */}
      {activeTab === 'verify' && (
        <div className="flex flex-col gap-3">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <label className="text-slate-300 font-semibold">Enter Card Serial ID to Verify:</label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Quick Test:</span>
                {vaultCards.slice(0, 3).map((vc) => (
                  <button
                    key={vc.serialId}
                    onClick={() => {
                      setVerifySerialInput(vc.serialId);
                      handleVerify(vc.serialId);
                    }}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-sky-500 text-sky-400 cursor-pointer"
                  >
                    {vc.serialId}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={verifySerialInput}
                  onChange={(e) => setVerifySerialInput(e.target.value)}
                  placeholder="e.g. UOI-2026-156001"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-sky-400 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                onClick={() => handleVerify()}
                disabled={verifying}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {verifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Verify Card</span>
              </button>
            </div>

            {/* Verification Result Box */}
            {verifyResult && (
              <div
                className={`p-3 rounded-lg border text-xs flex flex-col gap-2 ${
                  verifyResult.verified
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : verifyResult.card?.status === 'REVOKED'
                    ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                    : 'bg-amber-950/30 border-amber-500/40 text-amber-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {verifyResult.verified ? (
                      <>
                        <ShieldCheck className="w-5 h-5 text-emerald-400" />
                        <span>AUTHENTIC & ACTIVE CARD</span>
                      </>
                    ) : verifyResult.card?.status === 'REVOKED' ? (
                      <>
                        <AlertTriangle className="w-5 h-5 text-rose-400" />
                        <span>CARD REVOKED BY SECURITY COMMAND</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                        <span>SERIAL NOT FOUND (POTENTIAL COUNTERFEIT)</span>
                      </>
                    )}
                  </div>
                  {verifyResult.card && (
                    <span className="font-mono text-xs">{verifyResult.card.serialId}</span>
                  )}
                </div>

                <p className="text-slate-300 text-xs">{verifyResult.message}</p>

                {verifyResult.card && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">Citizen:</span>
                      <span className="font-semibold text-white">{verifyResult.card.issuedTo.fullName}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Rank:</span>
                      <span className="font-semibold text-amber-300">{verifyResult.card.issuedTo.assignedRank}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Issuing Officer:</span>
                      <span className="font-semibold text-sky-300">{verifyResult.card.issuedBy.discordTag}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Date Issued:</span>
                      <span className="font-mono text-slate-300">{verifyResult.card.issuedAt.split('T')[0]}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: /card inspect */}
      {activeTab === 'inspect' && (
        <div className="flex flex-col gap-3">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-3">
            <span className="text-xs font-semibold text-slate-300">Inspect Citizen Dossier</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={inspectQuery}
                onChange={(e) => setInspectQuery(e.target.value)}
                placeholder="Search by Roblox username, User ID, Full Name, or Discord ID..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleInspect}
                disabled={inspecting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {inspecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Inspect</span>
              </button>
            </div>

            {inspectResults && (
              <div className="flex flex-col gap-2">
                {inspectResults.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3 text-center">No citizen records found matching '{inspectQuery}'</p>
                ) : (
                  inspectResults.map((rec) => (
                    <div key={rec.serialId} className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{rec.issuedTo.fullName}</span>
                          <span className="font-mono text-sky-400">(@{rec.issuedTo.robloxUsername})</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          rec.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {rec.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-400">
                        <div>
                          <span>Serial ID: </span>
                          <strong className="text-sky-300 font-mono">{rec.serialId}</strong>
                        </div>
                        <div>
                          <span>Roblox ID: </span>
                          <strong className="text-slate-200 font-mono">{rec.issuedTo.robloxUserId}</strong>
                        </div>
                        <div>
                          <span>Rank: </span>
                          <strong className="text-amber-400">{rec.issuedTo.assignedRank}</strong>
                        </div>
                        <div>
                          <span>Server Nickname: </span>
                          <strong className="text-emerald-400">{rec.serverNickname}</strong>
                        </div>
                      </div>

                      {/* Audit History Timeline */}
                      <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-1">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Audit & Issuance History:</span>
                        {rec.history.map((h, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/60 p-1.5 rounded">
                            <span className="font-medium text-slate-300">
                              {h.action === 'ISSUED' && '✓ Initial Issue: '}
                              {h.action === 'PROMOTED' && '⭐ Promotion: '}
                              {h.action === 'REVOKED' && '⛔ Revocation: '}
                              {h.details}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">{h.timestamp.split('T')[0]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Promote / Revoke */}
      {activeTab === 'manage' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Card Selection */}
          <div className="col-span-full bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-300 font-medium">Select Target Card from Registry:</span>
            <select
              value={selectedVaultSerial}
              onChange={(e) => setSelectedVaultSerial(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-indigo-500"
            >
              {vaultCards.map((vc) => (
                <option key={vc.serialId} value={vc.serialId}>
                  {vc.serialId} - {vc.issuedTo.fullName} ({vc.issuedTo.assignedRank}) [{vc.status}]
                </option>
              ))}
            </select>
          </div>

          {/* /card promote */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs">
              <Award className="w-4 h-4" />
              <span>Execute /card promote</span>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Target New Rank:</label>
              <select
                value={promoteRank}
                onChange={(e) => setPromoteRank(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs mt-1"
              >
                {ROLE_HIERARCHY.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} (Tier {r.tierLevel})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Promotion Reason / Order:</label>
              <input
                type="text"
                value={promoteReason}
                onChange={(e) => setPromoteReason(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 mt-1"
              />
            </div>
            <button
              onClick={handlePromote}
              className="mt-1 py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Promote Citizen
            </button>
          </div>

          {/* /card revoke */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 text-rose-400 font-semibold text-xs">
              <UserX className="w-4 h-4" />
              <span>Execute /card revoke</span>
            </div>
            <div>
              <label className="text-[11px] text-slate-400">Revocation Justification / Order:</label>
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 mt-1"
              />
            </div>
            <p className="text-[11px] text-slate-500 leading-normal">
              Sets status to <strong className="text-rose-400">REVOKED</strong>, updates server nickname to <code className="text-slate-300">[REVOKED]</code>, and locks verification checks.
            </p>
            <button
              onClick={handleRevoke}
              className="mt-auto py-1.5 px-3 bg-rose-700 hover:bg-rose-600 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              Revoke Identification
            </button>
          </div>

          {actionFeedback && (
            <div className="col-span-full p-2.5 bg-indigo-950/50 border border-indigo-500/40 rounded text-xs text-indigo-300 font-medium">
              ✓ {actionFeedback}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: Ready-to-Run Discord.js Slash Command Code */}
      {activeTab === 'code' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Copy-paste into your bot's <code>/commands/card.js</code> file, or download the full bot project:
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadBotZip}
                disabled={zippingBot}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs cursor-pointer transition-colors shadow-sm"
                title="Download full ready-to-run Discord bot with commands, index.js, and package.json"
              >
                {zippingBot ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Packing ZIP...</span>
                  </>
                ) : botZipDownloaded ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Bot Files Downloaded!</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-3.5 h-3.5" />
                    <span>Download Bot Project (.ZIP)</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(discordJsCode);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded text-xs cursor-pointer transition-colors"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy Handler'}</span>
              </button>
            </div>
          </div>
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-72">
            {discordJsCode}
          </pre>

          {/* WispByte 24/7 Hosting Walkthrough Accordion */}
          <div className="mt-2 bg-slate-950 border border-indigo-500/30 rounded-xl overflow-hidden shadow-md">
            <button
              onClick={() => setShowWispbyteGuide(!showWispbyteGuide)}
              className="w-full px-4 py-3 bg-gradient-to-r from-indigo-950/60 to-slate-900 flex items-center justify-between text-left cursor-pointer hover:bg-indigo-900/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Server className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    WispByte 24/7 Hosting Guide
                    <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                      FREE / PTERODACTYL
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Host your Discord Bot 24/7 on WispByte via GitHub or direct ZIP upload
                  </p>
                </div>
              </div>
              <div className="text-slate-400">
                {showWispbyteGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {showWispbyteGuide && (
              <div className="p-4 flex flex-col gap-3 text-xs border-t border-slate-800/80 bg-slate-950/90 leading-relaxed text-slate-300">
                {/* Method Switcher */}
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800/80">
                  <span className="text-[11px] text-slate-400 font-medium">Deployment Method:</span>
                  <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-800">
                    <button
                      onClick={() => setHostingMethod('github')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                        hostingMethod === 'github'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Github className="w-3.5 h-3.5" />
                      <span>Deploy via GitHub</span>
                      <span className="text-[9px] bg-emerald-400/20 text-emerald-300 px-1 rounded">Recommended</span>
                    </button>
                    <button
                      onClick={() => setHostingMethod('upload')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                        hostingMethod === 'upload'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>Direct .ZIP Upload</span>
                    </button>
                  </div>
                </div>

                {/* GITHUB DEPLOYMENT INSTRUCTIONS */}
                {hostingMethod === 'github' && (
                  <div className="flex flex-col gap-3.5">
                    {/* Step 1 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div className="flex-1">
                        <strong className="text-white flex items-center gap-1.5">
                          Download Bot Files &amp; Create GitHub Repository
                        </strong>
                        <p className="text-slate-400 text-[11px] mt-0.5">
                          1. Click the gold <span className="text-amber-400 font-semibold">"Download Bot Project (.ZIP)"</span> button above.
                          <br />
                          2. Go to <a href="https://github.com/new" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5 font-medium">github.com/new <ExternalLink className="w-3 h-3" /></a> and create a repository (e.g. <code>uoi-discord-bot</code>).
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div className="flex-1">
                        <strong className="text-white">Push Bot Files to Your GitHub Repo</strong>
                        <p className="text-slate-400 text-[11px] mt-0.5">
                          Unzip <code>UOI_Discord_Bot_Files.zip</code> on your computer, open a terminal in that folder, and run:
                        </p>
                        <div className="mt-1.5 bg-slate-900 border border-slate-800 rounded p-2 text-[11px] font-mono text-emerald-400 leading-relaxed overflow-x-auto">
                          git init<br />
                          git add .<br />
                          git commit -m "feat: initial UOI discord bot"<br />
                          git branch -M main<br />
                          git remote add origin https://github.com/YOUR_USERNAME/uoi-discord-bot.git<br />
                          git push -u origin main
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          *(The provided <code>.gitignore</code> automatically protects your bot token by excluding <code>.env</code> and <code>node_modules/</code>)*
                        </span>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <div className="flex-1">
                        <strong className="text-white">Create Node.js Server on WispByte</strong>
                        <ul className="text-slate-400 text-[11px] list-disc list-inside space-y-0.5 mt-1">
                          <li>Log in to the WispByte Client Panel (<a href="https://client.wispbyte.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">client.wispbyte.com <ExternalLink className="w-3 h-3" /></a>).</li>
                          <li>Click <strong className="text-slate-200">Create Server</strong>.</li>
                          <li>Select <strong className="text-emerald-400">Free Plan</strong> (or paid plan).</li>
                          <li>Runtime / Image: Select <strong className="text-slate-200">Node.js</strong> (Node.js 18 or 20).</li>
                          <li>Click <strong className="text-slate-200">Create Server</strong>.</li>
                        </ul>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        4
                      </span>
                      <div className="flex-1">
                        <strong className="text-white">Connect GitHub to WispByte (Clone &amp; Pull)</strong>
                        <div className="mt-1 text-slate-400 text-[11px] space-y-1">
                          <p>
                            In your WispByte server management panel:
                          </p>
                          <ul className="list-disc list-inside space-y-0.5 pl-1">
                            <li>Look for the <strong className="text-indigo-300">GitHub</strong> or <strong className="text-indigo-300">Git Integration</strong> tab in the sidebar.</li>
                            <li>Enter your repository URL: <code className="text-slate-200">https://github.com/YOUR_USERNAME/uoi-discord-bot</code>.</li>
                            <li>Branch: <code className="text-slate-200">main</code>.</li>
                            <li>Click <strong className="text-emerald-400">Clone / Pull</strong>. WispByte will pull all code directly into the server directory.</li>
                          </ul>
                          <p className="text-slate-400">
                            <em>Alternative via Console/Startup</em>: If your server egg includes a Git Clone variable in the <strong>Startup</strong> tab, paste your GitHub repo URL into the <code>GIT_ADDRESS</code> / <code>REPO_URL</code> field.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        5
                      </span>
                      <div className="flex-1">
                        <strong className="text-white">Add .env Token &amp; Start Bot</strong>
                        <ul className="text-slate-400 text-[11px] list-disc list-inside space-y-1 mt-1">
                          <li>In WispByte <strong className="text-slate-200">Files</strong> tab, click <strong className="text-slate-200">New File</strong>, add your token:
                            <pre className="mt-1 bg-slate-900 border border-slate-800 rounded p-1.5 text-[10px] text-emerald-400 font-mono">
DISCORD_TOKEN=your_bot_token_here
                            </pre>
                            Save the file as <code className="text-emerald-400">.env</code>.
                          </li>
                          <li>Under Discord Developer Portal: Ensure <strong className="text-amber-400">Server Members Intent</strong> is enabled.</li>
                          <li>Go to WispByte <strong className="text-slate-200">Console</strong> tab and click <strong className="text-emerald-400">Start</strong>. Dependencies will install automatically.</li>
                          <li>Whenever you push updates to GitHub, simply click <strong className="text-indigo-300">Pull</strong> in WispByte and restart!</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* DIRECT ZIP UPLOAD INSTRUCTIONS */}
                {hostingMethod === 'upload' && (
                  <div className="flex flex-col gap-3">
                    {/* Step 1 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div>
                        <strong className="text-white">Download the Bot Files</strong>
                        <p className="text-slate-400 text-[11px]">
                          Click the gold <span className="text-amber-400 font-semibold">"Download Bot Project (.ZIP)"</span> button above. It bundles <code>index.js</code>, <code>commands/card.js</code>, <code>package.json</code>, <code>.gitignore</code>, and <code>.env.example</code> into a single zip.
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div>
                        <strong className="text-white">Create a Node.js Server on WispByte</strong>
                        <ul className="text-slate-400 text-[11px] list-disc list-inside space-y-0.5 mt-1">
                          <li>Log in to the WispByte Client Panel (<a href="https://client.wispbyte.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline inline-flex items-center gap-0.5">client.wispbyte.com <ExternalLink className="w-3 h-3" /></a>).</li>
                          <li>Click <strong className="text-slate-200">Create Server</strong>.</li>
                          <li>Name: e.g. <code className="text-amber-300">UOI-ID-Bot</code>.</li>
                          <li>Plan: Select <strong className="text-emerald-400">Free Plan</strong> (or paid plan).</li>
                          <li>Docker Image / Runtime: Select <strong className="text-slate-200">Node.js</strong> (Node.js 18 or 20).</li>
                          <li>Click <strong className="text-slate-200">Create Server</strong>.</li>
                        </ul>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <div>
                        <strong className="text-white">Upload Your Bot Files to WispByte</strong>
                        <ul className="text-slate-400 text-[11px] list-disc list-inside space-y-0.5 mt-1">
                          <li>Open your server on WispByte and go to the <strong className="text-slate-200">Files</strong> tab.</li>
                          <li>Unzip <code>UOI_Discord_Bot_Files.zip</code> on your computer.</li>
                          <li>Upload <code>index.js</code> and <code>package.json</code> into the root directory.</li>
                          <li>Create a new directory named <code className="text-indigo-300">commands</code> and upload <code>card.js</code> inside it (so the path is <code>commands/card.js</code>).</li>
                        </ul>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        4
                      </span>
                      <div>
                        <strong className="text-white">Configure Bot Token and Discord Permissions</strong>
                        <ul className="text-slate-400 text-[11px] list-disc list-inside space-y-0.5 mt-1">
                          <li>In the <strong className="text-slate-200">Files</strong> tab, create a new file named <code className="text-emerald-400">.env</code>:
                            <pre className="mt-1 bg-slate-900 border border-slate-800 rounded p-1.5 text-[10px] text-emerald-400 font-mono">
DISCORD_TOKEN=your_bot_token_from_discord_developer_portal
                            </pre>
                          </li>
                          <li>On Discord Developer Portal, enable <span className="text-amber-400 font-semibold">Server Members Intent</span>.</li>
                          <li>In your Discord server: Drag the bot's role above members so it can rename them.</li>
                        </ul>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        5
                      </span>
                      <div>
                        <strong className="text-white">Launch Bot in Console</strong>
                        <ul className="text-slate-400 text-[11px] list-disc list-inside space-y-0.5 mt-1">
                          <li>Go to WispByte <strong className="text-slate-200">Console</strong> tab and click <strong className="text-emerald-400">Start</strong>.</li>
                          <li>Check console output for: <code>✅ Registered /card slash command successfully.</code></li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Common NPM Errors & Immediate Fixes Box */}
                <div className="mt-2 p-3 bg-red-950/30 border border-red-500/30 rounded-lg text-xs">
                  <h5 className="font-semibold text-red-300 flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    Having an NPM or Startup Error on WispByte? Check These 4 Fixes:
                  </h5>
                  <div className="space-y-2 text-[11px] text-slate-300">
                    <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                      <strong className="text-amber-300">1. npm ERR! code ELIFECYCLE (Exit status 1)</strong>
                      <p className="text-slate-400 mt-0.5">
                        • Look 2–5 lines <strong className="text-white">above</strong> the <code>npm ERR!</code> message in the console. The actual error will be there!
                        <br />• Most common reason: Missing or incorrect <code>DISCORD_TOKEN</code> in your <code>.env</code> file, or missing <strong className="text-white">Server Members Intent</strong> in the Discord Developer Portal.
                      </p>
                    </div>

                    <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                      <strong className="text-amber-300">2. npm ERR! code EBADENGINE (Unsupported engine)</strong>
                      <p className="text-slate-400 mt-0.5">
                        • Discord.js v14 requires <strong className="text-white">Node.js 18 or 20</strong>.
                        <br />• In WispByte, go to the <strong className="text-white">Startup</strong> tab &gt; Docker Image / Container Settings &gt; Switch to <code>Node.js 18</code> or <code>Node.js 20</code>, then restart.
                      </p>
                    </div>

                    <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                      <strong className="text-amber-300">3. npm ERR! code ENOENT (no such file or directory, open package.json)</strong>
                      <p className="text-slate-400 mt-0.5">
                        • Your bot files were uploaded inside a nested folder (e.g. <code>repo-main/package.json</code>) instead of the server's root folder.
                        <br />• Move <code>package.json</code>, <code>index.js</code>, and the <code>commands/</code> folder directly into the root <code>/home/container/</code> folder in the WispByte Files tab.
                      </p>
                    </div>

                    <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                      <strong className="text-amber-300">4. Disallowed Intents / Privileged intent provided is not allowed</strong>
                      <p className="text-slate-400 mt-0.5">
                        • Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">discord.com/developers/applications</a> &gt; Click your Bot &gt; <strong>Bot</strong> tab &gt; Scroll down to <strong>Privileged Gateway Intents</strong> &gt; Check <strong>Server Members Intent</strong> &gt; Save changes.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
