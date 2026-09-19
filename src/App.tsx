import { useState, useMemo } from 'react';
import { RawPayloadInput, ProcessedCardData, ROLE_HIERARCHY, DEFAULT_RANK, RobloxUserData } from './types';
import { processUoiPayload } from './utils/processor';
import { CanvasIdCard } from './components/CanvasIdCard';
import { HierarchyReference } from './components/HierarchyReference';
import { RobloxApiConnector } from './components/RobloxApiConnector';
import { DiscordBotCommandHub } from './components/DiscordBotCommandHub';
import {
  Shield,
  Copy,
  Check,
  RefreshCw,
  Terminal,
  FileCode,
  Sparkles,
  Zap,
  Archive,
} from 'lucide-react';

const PRESETS: { name: string; tag: string; data: RawPayloadInput }[] = [
  {
    name: 'Presidential Command',
    tag: 'TIER 1',
    data: {
      fullName: 'Aarav Dev Sharma',
      robloxUsername: 'Aarav_Prez99',
      robloxUserId: '1092837461',
      gender: 'Male',
      roleIds: ['123456789012345678', '456789012345678901'],
    },
  },
  {
    name: 'Builderman (Official Roblox)',
    tag: 'ROBLOX API',
    data: {
      fullName: 'David Baszucki',
      robloxUsername: 'Builderman',
      robloxUserId: '156',
      gender: 'Male',
      roleIds: ['123456789012345678'],
    },
  },
  {
    name: 'Prime Minister Office',
    tag: 'TIER 2',
    data: {
      fullName: 'Vikramaditya Rao',
      robloxUsername: 'Vikram_RTP',
      robloxUserId: '882736192',
      gender: 'Male',
      roleIds: ['234567890123456789', '556789012345678902'],
    },
  },
  {
    name: 'Senate Assembly',
    tag: 'TIER 3',
    data: {
      fullName: 'Ananya Deshmukh',
      robloxUsername: 'Ananya_Senate',
      robloxUserId: '556102938',
      gender: 'Female',
      roleIds: ['345678901234567890'],
    },
  },
  {
    name: 'Security Force Commander',
    tag: 'TIER 4',
    data: {
      fullName: 'Arjun Pratap Singh',
      robloxUsername: 'Ghost_Viper_07',
      robloxUserId: '723910245',
      gender: 'Male',
      roleIds: ['456789012345678901'],
    },
  },
  {
    name: 'Cabinet Minister',
    tag: 'TIER 5',
    data: {
      fullName: 'Meera Nambiar',
      robloxUsername: 'Meera_Cabinet',
      robloxUserId: '661920384',
      gender: 'Female',
      roleIds: ['556789012345678902'],
    },
  },
  {
    name: 'Dirty Raw Stream (Sanitization Test)',
    tag: 'SANITIZE TEST',
    data: {
      fullName: '✨⚡ Rohan [UOI] ~ Verma 🔥👑',
      robloxUsername: '🔥Rohan_Pro__99!!#$',
      robloxUserId: 'ID# 9988221144 ABC',
      gender: 'Male',
      roleIds: ['999999999999999999'], // Non-admin -> Community Member
    },
  },
];

export default function App() {
  const [input, setInput] = useState<RawPayloadInput>(PRESETS[0].data);
  const [rawRoleIdsText, setRawRoleIdsText] = useState<string>(PRESETS[0].data.roleIds.join(', '));
  const [copied, setCopied] = useState<boolean>(false);

  // Serial ID state synchronized with Canvas and Discord Command Hub
  const [currentSerialId, setCurrentSerialId] = useState<string>(() => {
    return `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  });

  // Roblox Live API state
  const [robloxUser, setRobloxUser] = useState<RobloxUserData | null>(null);
  const [robloxAvatar, setRobloxAvatar] = useState<string | null>(null);
  const [activeAvatarType, setActiveAvatarType] = useState<'avatar' | 'avatar-bust' | 'avatar-headshot'>('avatar');

  const handleApplyRobloxUser = (user: RobloxUserData, avatarDataUrl: string) => {
    setRobloxUser(user);
    setRobloxAvatar(avatarDataUrl);
    setInput((prev) => ({
      ...prev,
      robloxUsername: user.name,
      robloxUserId: user.id.toString(),
      fullName: (!prev.fullName || prev.fullName === 'Aarav Dev Sharma') ? user.displayName : prev.fullName,
    }));
  };

  const handleAvatarTypeChange = (avatarDataUrl: string) => {
    setRobloxAvatar(avatarDataUrl);
  };

  // Compute roles this citizen actually possesses from active role IDs
  const citizenHeldRoles = useMemo(() => {
    return ROLE_HIERARCHY.filter((role) => input.roleIds.includes(role.id.trim()));
  }, [input.roleIds]);

  // Parse and process payload into strict schema
  const processedData: ProcessedCardData = useMemo(() => {
    return processUoiPayload(input);
  }, [input]);

  // Strict formatted JSON output
  const jsonOutputString = useMemo(() => {
    return JSON.stringify(processedData, null, 2);
  }, [processedData]);

  // Handle role IDs text change
  const handleRoleIdsChange = (text: string) => {
    setRawRoleIdsText(text);
    const parsedIds = text
      .split(/[\n,]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    setInput((prev) => ({ ...prev, roleIds: parsedIds, selectedRank: undefined }));
  };

  // Toggle role from reference list
  const handleToggleRole = (roleId: string) => {
    let newRoles: string[];
    if (input.roleIds.includes(roleId)) {
      newRoles = input.roleIds.filter((id) => id !== roleId);
    } else {
      newRoles = [...input.roleIds, roleId];
    }
    setInput((prev) => ({ ...prev, roleIds: newRoles, selectedRank: undefined }));
    setRawRoleIdsText(newRoles.join(', '));
  };

  // Preset selector
  const handleSelectPreset = (preset: (typeof PRESETS)[0]) => {
    setInput(preset.data);
    setRawRoleIdsText(preset.data.roleIds.join(', '));
  };

  // Copy strict JSON string
  const handleCopyJson = () => {
    navigator.clipboard.writeText(jsonOutputString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="uoi-app-root" className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header id="uoi-header" className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 via-orange-600 to-amber-700 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Shield className="w-5 h-5 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  Union of Indians (UOI)
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full uppercase">
                  Roblox: Rise to Presidency
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Backend Data Processing Module & Canvas Scripting Node
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              NODE STATUS: ACTIVE
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Preset Quick Selectors */}
        <section id="presets-section" className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Slash Command Simulation Presets</span>
            </div>
            <span className="text-[11px] text-slate-400">Click to simulate interaction stream</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                id={`preset-btn-${preset.tag.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => handleSelectPreset(preset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-2 border ${
                  input.robloxUsername === preset.data.robloxUsername
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 shadow-sm'
                    : 'bg-slate-800/70 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <span>{preset.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 font-mono">
                  {preset.tag}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Dual Column Layout: Left Input Matrix & Role Rules, Right Canvas & Strict JSON Output */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Input Data Matrix (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Live Roblox Official API Sync Module */}
            <RobloxApiConnector
              currentUsername={input.robloxUsername}
              currentUserId={input.robloxUserId}
              onApplyRobloxUser={handleApplyRobloxUser}
              onAvatarTypeChange={handleAvatarTypeChange}
              activeAvatarType={activeAvatarType}
              setActiveAvatarType={setActiveAvatarType}
            />

            {/* Input Data Matrix Panel */}
            <div id="input-payload-panel" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-amber-400" />
                  <h2 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
                    Raw Interaction Data Matrix
                  </h2>
                </div>
                <button
                  id="btn-reset-input"
                  onClick={() => handleSelectPreset(PRESETS[0])}
                  className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 cursor-pointer"
                  title="Reset to default"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Field 1: Full / Display Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>1. Full Name / Display Name</span>
                  <span className="text-[10px] text-slate-500 font-mono">Raw Text</span>
                </label>
                <input
                  id="input-fullname"
                  type="text"
                  value={input.fullName}
                  onChange={(e) => setInput({ ...input, fullName: e.target.value })}
                  placeholder="e.g. Aarav Dev Sharma"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono"
                />
              </div>

              {/* Field 2: Roblox Username */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>2. Roblox Username</span>
                  <span className="text-[10px] text-slate-500 font-mono">Standard Sanitation</span>
                </label>
                <input
                  id="input-roblox-username"
                  type="text"
                  value={input.robloxUsername}
                  onChange={(e) => setInput({ ...input, robloxUsername: e.target.value })}
                  placeholder="e.g. Aarav_Prez99 or ✨Emoji_User👑"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono"
                />
                <span className="text-[10px] text-slate-500">
                  Strips emojis and special characters; keeps alphanumeric, underscores, spaces.
                </span>
              </div>

              {/* Field 3: Numerical Roblox User ID */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>3. Numerical Roblox User ID</span>
                  <span className="text-[10px] text-slate-500 font-mono">Digits Only</span>
                </label>
                <input
                  id="input-roblox-userid"
                  type="text"
                  value={input.robloxUserId}
                  onChange={(e) => setInput({ ...input, robloxUserId: e.target.value })}
                  placeholder="e.g. 1092837461"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono"
                />
              </div>

              {/* Field 4: User Selected Gender (Restricted to Male, Female, or Other) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>4. Selected Gender</span>
                  <span className="text-[10px] text-amber-400/90 font-mono">Strict Choices: Male / Female / Other</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['Male', 'Female', 'Other'].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setInput({ ...input, gender: g })}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer text-center ${
                        input.gender.toLowerCase() === g.toLowerCase()
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Field 5: Discord Server Role IDs Array */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>5. Active Discord Server Role IDs Array</span>
                  <span className="text-[10px] text-slate-500 font-mono">{input.roleIds.length} Detected</span>
                </label>
                <textarea
                  id="input-roleids"
                  rows={2}
                  value={rawRoleIdsText}
                  onChange={(e) => handleRoleIdsChange(e.target.value)}
                  placeholder="Paste comma or newline separated role IDs..."
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500">
                  Evaluated against hierarchy: 123456789012345678 (President) &gt; 234567890123456789 (PM) &gt; 345678901234567890 (Senator)...
                </span>
              </div>

              {/* Field 6: Rank Option (Strictly restricted to roles this citizen possesses) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>6. Rank Option (Citizen's Roles Only)</span>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    {citizenHeldRoles.length > 0
                      ? `${citizenHeldRoles.length} Held Role${citizenHeldRoles.length > 1 ? 's' : ''}`
                      : 'Community Member (Default)'}
                  </span>
                </label>
                {citizenHeldRoles.length > 0 ? (
                  <select
                    id="select-citizen-rank"
                    value={processedData.assignedRank}
                    onChange={(e) => setInput((prev) => ({ ...prev, selectedRank: e.target.value }))}
                    className="w-full bg-slate-950 border border-emerald-500/50 rounded-lg px-3 py-2 text-sm text-amber-300 font-semibold focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono cursor-pointer"
                  >
                    {citizenHeldRoles.map((role) => (
                      <option key={role.id} value={role.name} className="bg-slate-950 text-slate-200">
                        {role.name} (Tier {role.tierLevel} - {role.title})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="w-full bg-slate-950/80 border border-dashed border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-400 flex items-center justify-between">
                    <span className="text-slate-300 font-medium">COMMUNITY MEMBER</span>
                    <span className="text-[10px] text-slate-500 italic">Universal tier (no admin roles held)</span>
                  </div>
                )}
                <span className="text-[10px] text-slate-500">
                  Matches Discord bot security: the rank option is strictly constrained to roles this citizen actually holds.
                </span>
              </div>
            </div>

            {/* Hierarchy Reference & Interactive Toggle */}
            <HierarchyReference
              selectedRoleIds={input.roleIds}
              onToggleRole={handleToggleRole}
            />
          </div>

          {/* Right Column: Canvas ID Card & Strict JSON Output (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            {/* HTML5 Canvas ID Card Simulation */}
            <CanvasIdCard
              data={processedData}
              robloxAvatar={robloxAvatar}
              robloxUser={robloxUser}
              externalSerialId={currentSerialId}
              onSerialIdChange={setCurrentSerialId}
            />

            {/* Live Discord Bot Command Hub & Audit Vault */}
            <DiscordBotCommandHub
              currentCardData={processedData}
              currentSerialId={currentSerialId}
            />

            {/* Strict JSON Output Protocol Box */}
            <div id="strict-json-panel" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
                    Strict Downstream JSON Payload Output
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    SCHEMA: EXACT COMPLIANCE
                  </span>
                  <button
                    id="btn-quick-download-zip"
                    onClick={() => {
                      const btn = document.getElementById('btn-download-zip');
                      if (btn) btn.click();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors cursor-pointer shadow-sm"
                    title="Download complete citizen ID bundle (.ZIP)"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Download .ZIP</span>
                  </button>
                  <button
                    id="btn-copy-strict-json"
                    onClick={handleCopyJson}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy JSON String</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* JSON Display Area */}
              <div className="relative">
                <pre
                  id="json-output-display"
                  className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-emerald-400 font-mono overflow-x-auto leading-relaxed"
                >
                  {jsonOutputString}
                </pre>
              </div>

              {/* Rules Verification Checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-800 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Sanitized &amp; Upper Cased</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Highest Role Assigned</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Ready for Canvas Node</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-4 py-3 text-center text-xs text-slate-500 font-mono">
        Union of Indians (UOI) // Roblox RTP ID Card Scripting Node // Standard Specification Protocol
      </footer>
    </div>
  );
}
