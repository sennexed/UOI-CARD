import { useState, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import {
  ProcessedCardData,
  ROLE_HIERARCHY,
  CardRecord,
  CardAuditActor,
} from '../types';
import { getStoredImage } from '../utils/imageStore';
import { discordJsCode } from '../data/discordBotCode';
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
  Eye,
  IdCard,
} from 'lucide-react';

interface DiscordBotCommandHubProps {
  currentCardData: ProcessedCardData;
  currentSerialId: string;
}

export function DiscordBotCommandHub({
  currentCardData,
  currentSerialId,
}: DiscordBotCommandHubProps) {
  const [activeTab, setActiveTab] = useState<'generate' | 'show' | 'verify' | 'inspect' | 'manage' | 'code'>('generate');

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

  // Form inputs for /card generate restricted options
  const [selectedGenerateGender, setSelectedGenerateGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [selectedGenerateRank, setSelectedGenerateRank] = useState<string>(
    currentCardData.assignedRank || 'COMMUNITY MEMBER'
  );

  // Compute roles this citizen actually possesses in this server
  const citizenRoles = useMemo(() => {
    const matched = ROLE_HIERARCHY.filter((r) => currentCardData.roleIds?.includes(r.id));
    if (matched.length > 0) return matched;
    return [{ id: 'default', name: currentCardData.assignedRank || 'COMMUNITY MEMBER', title: 'Community Member' }];
  }, [currentCardData.roleIds, currentCardData.assignedRank]);

  useEffect(() => {
    if (currentCardData.gender) {
      const g = currentCardData.gender.toUpperCase();
      if (g.includes('FEMALE') || g === 'F') setSelectedGenerateGender('Female');
      else if (g.includes('MALE') || g === 'M') setSelectedGenerateGender('Male');
      else setSelectedGenerateGender('Other');
    }
  }, [currentCardData.gender]);

  useEffect(() => {
    if (currentCardData.assignedRank) {
      setSelectedGenerateRank(currentCardData.assignedRank);
    }
  }, [currentCardData.assignedRank]);

  // /card show state
  const [showTargetInput, setShowTargetInput] = useState<string>('883322114455667788');
  const [showResult, setShowResult] = useState<{
    found?: boolean;
    card?: CardRecord;
    message?: string;
  } | null>(null);
  const [showingCard, setShowingCard] = useState<boolean>(false);

  // 1 card per person warning state
  const [duplicateWarning, setDuplicateWarning] = useState<{
    message: string;
    existingCard?: CardRecord;
  } | null>(null);

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

  // Command 1: /card generate (1 card per person check)
  const handleIssueCard = async () => {
    setDuplicateWarning(null);
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
            assignedRank: selectedGenerateRank || currentCardData.assignedRank,
            gender: selectedGenerateGender,
          },
          issuedBy: executor,
        }),
      });

      const json = await resp.json();

      if (resp.status === 409) {
        setDuplicateWarning({
          message: json.error || 'Citizen already has an active card registered.',
          existingCard: json.card,
        });
        return;
      }

      if (resp.ok) {
        setIssueSuccess(true);
        setDuplicateWarning(null);
        fetchVault();
        setTimeout(() => setIssueSuccess(false), 4000);
      }
    } catch (err) {
      console.error('Failed to issue card:', err);
    }
  };

  // Command 2: /card show [user]
  const handleExecuteShow = async (targetToLookup?: string) => {
    const query = (targetToLookup || showTargetInput).trim();
    if (!query) return;
    setShowingCard(true);
    setShowResult(null);

    try {
      const resp = await fetch(`/api/card/show/${encodeURIComponent(query)}`);
      const json = await resp.json();
      setShowResult(json);
    } catch (err: any) {
      setShowResult({
        found: false,
        message: 'Error querying card database: ' + err.message,
      });
    } finally {
      setShowingCard(false);
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

// Using modular imported discordJsCode with 1 template per server & 1 card per person

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
          deploy: 'node deploy-commands.js',
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

  // Register /card slash command with Discord API
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering slash commands with Discord API...');

    // 1. INSTANT GUILD SYNC (0-second delay for all connected servers)
    const connectedGuilds = Array.from(client.guilds.cache.values());
    console.log(\`⚡ Deploying instant slash commands to \${connectedGuilds.length} connected server(s)...\`);
    for (const guild of connectedGuilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: [cardCommand.data.toJSON()] },
        );
        console.log(\`   ✅ Instant slash commands deployed for: \${guild.name} (\${guild.id})\`);
      } catch (gErr) {
        console.warn(\`   ⚠️ Could not deploy to server \${guild.name}: \${gErr.message}\`);
      }
    }

    // 2. Global deployment for long-term consistency
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [cardCommand.data.toJSON()] },
    );
    console.log('✅ Registered global /card slash command successfully.');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error.message);
  }
});

// Auto-register instant guild slash command whenever bot is added to a new server
client.on('guildCreate', async (guild) => {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guild.id),
      { body: [cardCommand.data.toJSON()] },
    );
    console.log(\`⚡ Instant slash commands deployed to newly joined server: \${guild.name} (\${guild.id})\`);
  } catch (err) {
    console.error(\`Failed to deploy commands to \${guild.name}:\`, err.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  // Autocomplete interaction: dynamically filters ranks to only roles this citizen has & shows gender choices
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'card' && cardCommand.autocomplete) {
      try {
        await cardCommand.autocomplete(interaction);
      } catch (err) {
        console.error('Autocomplete interaction error:', err);
      }
    }
    return;
  }

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

      // 4. deploy-commands.js utility for instant command synchronization
      const deployCommandsJs = `require('dotenv').config();
const { REST, Routes } = require('discord.js');
const cardCommand = require('./commands/card.js');

const token = (process.env.DISCORD_TOKEN || '').trim();
const guildId = (process.env.DISCORD_GUILD_ID || '').trim();

if (!token) {
  console.error('❌ DISCORD_TOKEN is missing in .env!');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('🔄 Deploying /card slash command schema to Discord...');
    const currentUser = await rest.get(Routes.user());
    
    if (guildId) {
      console.log(\`🎯 Deploying INSTANT Guild Commands to server ID: \${guildId}\`);
      await rest.put(
        Routes.applicationGuildCommands(currentUser.id, guildId),
        { body: [cardCommand.data.toJSON()] },
      );
      console.log('✅ Successfully deployed Instant Guild Slash Commands! (0s delay in Discord)');
    } else {
      console.log('🌐 Deploying globally. (Tip: Set DISCORD_GUILD_ID in .env for instant 0s guild updates!)');
      await rest.put(
        Routes.applicationCommands(currentUser.id),
        { body: [cardCommand.data.toJSON()] },
      );
      console.log('✅ Successfully registered global slash commands.');
    }
  } catch (error) {
    console.error('❌ Command deployment failed:', error);
  }
})();
`;
      zip.file('deploy-commands.js', deployCommandsJs);

      // 5. .env.example
      zip.file(
        '.env.example',
        '# Discord Bot Token from Discord Developer Portal -> Bot tab\nDISCORD_TOKEN=your_bot_token_here\n\n# Optional: Your Discord Server (Guild) ID for 0-second instant slash command & choice updates\nDISCORD_GUILD_ID=\n\n# Optional: Direct URL to official permanent template image (if not uploading template.png directly)\nTEMPLATE_URL=\n'
      );

      // 5. .gitignore for GitHub repository
      zip.file('.gitignore', 'node_modules/\n.env\n.DS_Store\n*.log\npackage-lock.json\n');

      // 6. Database folder and template storage
      zip.file('data/cards.json', JSON.stringify({ cards: {}, serToUser: {} }, null, 2));

      // 7. Automatically include official template.png if saved in browser or server
      const savedTemplate = await getStoredImage('card_template');
      if (savedTemplate && savedTemplate.includes('base64,')) {
        const b64 = savedTemplate.split('base64,')[1];
        zip.file('template.png', b64, { base64: true });
        zip.file('templates/default.png', b64, { base64: true });
      } else {
        try {
          const resp = await fetch('/api/template');
          if (resp.ok) {
            const arr = await resp.arrayBuffer();
            zip.file('template.png', arr);
            zip.file('templates/default.png', arr);
          }
        } catch (_) {}
      }

      // 8. README.md
      const readmeBot = `# Union of Indians (UOI) Discord Bot

## Quick Setup
1. Run \`npm install\`
2. Create a \`.env\` file:
   \`\`\`env
   DISCORD_TOKEN=your_discord_bot_token
   # Optional: Direct link to template image if not using local template.png
   # TEMPLATE_URL=https://...
   \`\`\`
3. **Template Setup (CRITICAL - 1 Template Per Server)**:
   - **In Discord**: Type \`/card set-template\` in your server and attach your official template image.
     The bot will permanently store it as \`templates/{server_id}.png\` strictly for your server!
   - Alternatively, \`template.png\` in the bot's root folder acts as the global fallback.
4. Run \`node index.js\`

## Core Rules & Features:
- **1 Card Per Person**: The bot prevents duplicate cards. If a user already has an active card, \`/card generate\` alerts the officer with their existing serial and directs them to \`/card show\`.
- **1 Template Per Server**: Each Discord server can configure its own official template slot using \`/card set-template\`.
- **Persistent Database**: Cards are safely stored in \`data/cards.json\`.

## Slash Commands:
- \`/card generate\`: Issues citizen card with Roblox avatar and official server template (Strictly 1 card per person).
- \`/card show [citizen]\`: Pulls the citizen's card from the database and renders the card image on demand.
- \`/card set-template\`: Upload or change the server's official template image (1 template per server).
- \`/card view-template\`: View the currently active template image for this server.
- \`/card verify [serial]\`: Verifies authenticity and active status of an issued card in the database.
- \`/card inspect @user\`: Citizen dossier and card status.
- \`/card promote\`: Upgrades rank tier in the database.
- \`/card revoke\`: Revokes and blacklists credentials in the database, releasing the slot for reissuing.
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
            onClick={() => setActiveTab('show')}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              activeTab === 'show' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            /card show
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

              {/* Slash Command Options: Constrained Gender & Citizen-Only Ranks */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800/80">
                <div>
                  <label className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Gender Option:</span>
                    <span className="text-[9px] text-amber-400 font-mono">3 Choices</span>
                  </label>
                  <select
                    value={selectedGenerateGender}
                    onChange={(e) => setSelectedGenerateGender(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500 mt-1 cursor-pointer"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Rank (Citizen's Roles):</span>
                    <span className="text-[9px] text-emerald-400 font-mono">{citizenRoles.length} Available</span>
                  </label>
                  <select
                    value={selectedGenerateRank}
                    onChange={(e) => setSelectedGenerateRank(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-amber-300 font-semibold text-xs focus:outline-none focus:border-indigo-500 mt-1 cursor-pointer"
                  >
                    {citizenRoles.map((r) => (
                      <option key={r.id} value={r.name} className="bg-slate-950 text-slate-200">
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 bg-slate-900/60 px-2 py-1 rounded border border-slate-800/60">
                <span className="text-slate-400">Card Serial: <strong className="text-sky-400 font-mono">{currentSerialId}</strong></span>
                <span className="text-slate-400">Active Rank: <strong className="text-amber-400">{selectedGenerateRank}</strong></span>
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

          {/* 1 Card Per Person Policy Warning */}
          {duplicateWarning && (
            <div className="bg-amber-950/40 border border-amber-500/50 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 flex flex-col gap-1">
                <div className="font-bold flex items-center gap-2">
                  <span>1 Card Per Person Policy Block</span>
                  {duplicateWarning.existingCard && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                      {duplicateWarning.existingCard.serialId}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-amber-300/90 leading-relaxed">
                  {duplicateWarning.message}
                </p>
                {duplicateWarning.existingCard && (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => {
                        setShowTargetInput(duplicateWarning.existingCard?.serialId || '');
                        setActiveTab('show');
                        handleExecuteShow(duplicateWarning.existingCard?.serialId);
                      }}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-[11px] cursor-pointer flex items-center gap-1.5 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Existing Card with /card show</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

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

      {/* TAB: /card show [citizen] */}
      {activeTab === 'show' && (
        <div className="flex flex-col gap-3">
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <IdCard className="w-4 h-4 text-emerald-400" />
                <label className="text-slate-200 font-semibold">
                  Retrieve Citizen Card from Central Database (<code className="text-emerald-400">/card show</code>):
                </label>
              </div>
              <span className="text-[11px] text-slate-400">
                1 Card Per Person Policy • Server Template Rendered
              </span>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={showTargetInput}
                  onChange={(e) => setShowTargetInput(e.target.value)}
                  placeholder="Enter Discord User ID, Discord Tag, Roblox Username, or Serial ID..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={() => handleExecuteShow()}
                disabled={showingCard}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {showingCard ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>Fetch Card</span>
              </button>
            </div>

            {/* Quick selectors from vault */}
            {vaultCards.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-slate-500">Quick view from database:</span>
                {vaultCards.slice(0, 4).map((c) => (
                  <button
                    key={c.serialId}
                    onClick={() => {
                      setShowTargetInput(c.serialId);
                      handleExecuteShow(c.serialId);
                    }}
                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-emerald-500 text-emerald-400 font-mono text-[10px] cursor-pointer transition-colors"
                  >
                    {c.issuedTo.fullName} ({c.serialId})
                  </button>
                ))}
              </div>
            )}

            {/* Show Results Display */}
            {showResult && (
              <div
                className={`p-4 rounded-lg border text-xs flex flex-col gap-3 ${
                  showResult.found
                    ? 'bg-emerald-950/20 border-emerald-500/40 text-slate-200'
                    : 'bg-rose-950/20 border-rose-500/40 text-rose-300'
                }`}
              >
                {showResult.found && showResult.card ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-emerald-400 font-bold text-sm">
                          {showResult.card.serialId}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {showResult.card.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Issued: {new Date(showResult.card.issuedAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                      <div>
                        <span className="text-slate-400">Citizen Name:</span>
                        <p className="font-bold text-slate-100">{showResult.card.issuedTo.fullName}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Rank / Role:</span>
                        <p className="font-bold text-amber-400">{showResult.card.issuedTo.assignedRank}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Roblox Identity:</span>
                        <p className="font-mono text-sky-400">@{showResult.card.issuedTo.robloxUsername || 'Unlinked'}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Discord ID:</span>
                        <p className="font-mono text-slate-300">{showResult.card.issuedTo.discordId}</p>
                      </div>
                    </div>

                    <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800 text-[11px] flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Server Nickname:</span>
                        <code className="font-mono text-emerald-300">{showResult.card.serverNickname}</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Issued by:</span>
                        <span className="text-amber-300 font-medium">{showResult.card.issuedBy.discordTag}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{showResult.message || 'No active citizen card found in the database.'}</span>
                  </div>
                )}
              </div>
            )}
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

                    <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                      <strong className="text-amber-300">5. Dialogue box / dropdown doesn't appear for Gender &amp; Role in Discord?</strong>
                      <p className="text-slate-400 mt-0.5 leading-relaxed">
                        • <strong>Discord Client Cache</strong>: Discord desktop and mobile apps cache slash command options locally. Press <strong className="text-white">Ctrl + R</strong> on desktop (or restart the Discord app on mobile) to refresh the command cache so the dropdown choices and role autocomplete appear.
                        <br />• <strong>Instant 0s Server Deployment</strong>: In the updated code, the bot automatically deploys instant Guild Commands upon startup so you don't have to wait 1 hour for Discord's global cache. You can also run <code className="text-emerald-400">node deploy-commands.js</code> anytime.
                        <br />• <strong>Interactive Dialogue Box Fallback</strong>: If you run <code className="text-emerald-400">/card generate citizen:@user roblox:Name fullname:Name</code> without typing gender or rank, the bot immediately posts an interactive message with Dropdown Dialogue Menus (Select Menus) right in the Discord channel!
                        <br />• <strong>Server Members Intent</strong>: Make sure <strong className="text-white">Server Members Intent</strong> is turned ON so the bot has permission to view the citizen's actual server roles.
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
