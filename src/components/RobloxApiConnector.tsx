import { useState, useEffect } from 'react';
import { RobloxUserData, RobloxAvatarData } from '../types';
import {
  Globe2,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Sparkles,
  UserCheck,
  Camera,
  Calendar,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

interface RobloxApiConnectorProps {
  currentUsername: string;
  currentUserId: string;
  onApplyRobloxUser: (user: RobloxUserData, avatarDataUrl: string) => void;
  onAvatarTypeChange: (avatarDataUrl: string) => void;
  activeAvatarType: 'avatar' | 'avatar-bust' | 'avatar-headshot';
  setActiveAvatarType: (type: 'avatar' | 'avatar-bust' | 'avatar-headshot') => void;
}

export function RobloxApiConnector({
  currentUsername,
  currentUserId,
  onApplyRobloxUser,
  onAvatarTypeChange,
  activeAvatarType,
  setActiveAvatarType,
}: RobloxApiConnectorProps) {
  const [query, setQuery] = useState<string>(currentUsername || currentUserId || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [userData, setUserData] = useState<RobloxUserData | null>(null);
  const [avatarData, setAvatarData] = useState<RobloxAvatarData | null>(null);
  const [activeAvatarPreview, setActiveAvatarPreview] = useState<string | null>(null);
  const [typeLoading, setTypeLoading] = useState<boolean>(false);

  // Sync query when props change if user hasn't typed anything else
  useEffect(() => {
    if (!userData && (currentUsername || currentUserId)) {
      setQuery(currentUsername || currentUserId);
    }
  }, [currentUsername, currentUserId, userData]);

  const handleFetchRoblox = async (searchQuery?: string) => {
    const targetQuery = (searchQuery ?? query).trim();
    if (!targetQuery) {
      setError('Please enter a Roblox Username or User ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(`/api/roblox/user/${encodeURIComponent(targetQuery)}`);
      const data = await resp.json();

      if (!resp.ok || !data.success) {
        throw new Error(data.error || 'Failed to find Roblox user');
      }

      setUserData(data.user);
      setAvatarData(data.avatar);

      // Default to full body avatar for the card (matches the template avatar box)
      const initialAvatar = data.avatar.fullBodyDataUrl || data.avatar.bustDataUrl || '';
      setActiveAvatarPreview(initialAvatar);
      setActiveAvatarType('avatar');

      // Sync back to main form and canvas
      if (initialAvatar) {
        onApplyRobloxUser(data.user, initialAvatar);
      }
    } catch (err: any) {
      setError(err.message || 'Error connecting to Roblox API');
      setUserData(null);
      setAvatarData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAvatarType = async (type: 'avatar' | 'avatar-bust' | 'avatar-headshot') => {
    if (!userData) return;
    setActiveAvatarType(type);
    setTypeLoading(true);

    try {
      const resp = await fetch(`/api/roblox/avatar-data?userId=${userData.id}&type=${type}`);
      const data = await resp.json();
      if (resp.ok && data.dataUrl) {
        setActiveAvatarPreview(data.dataUrl);
        onAvatarTypeChange(data.dataUrl);
      }
    } catch (err) {
      console.error('Failed to change avatar type:', err);
    } finally {
      setTypeLoading(false);
    }
  };

  return (
    <div
      id="roblox-api-module"
      className="bg-slate-900/90 border border-sky-500/30 rounded-xl p-4 shadow-sm flex flex-col gap-3 relative overflow-hidden"
    >
      {/* Background accent glow */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
            <Globe2 className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-slate-200 uppercase flex items-center gap-1.5">
              <span>Roblox Official API Sync</span>
              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                LIVE
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Fetch verified player profile &amp; 3D avatar render straight onto the card
            </p>
          </div>
        </div>

        {userData && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Connected</span>
          </span>
        )}
      </div>

      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            id="input-roblox-api-query"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFetchRoblox();
            }}
            placeholder="Enter Roblox Username or Numerical ID (e.g. Builderman)"
            className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-mono"
          />
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
        </div>

        <button
          id="btn-fetch-roblox-api"
          type="button"
          onClick={() => handleFetchRoblox()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Fetching...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Fetch Profile</span>
            </>
          )}
        </button>
      </div>

      {/* Quick Test Accounts */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-wrap">
        <span className="text-slate-500 text-[10px] font-mono">Quick Test:</span>
        {['Builderman', 'Roblox', 'Stickmasterluke'].map((testUser) => (
          <button
            key={testUser}
            type="button"
            onClick={() => {
              setQuery(testUser);
              handleFetchRoblox(testUser);
            }}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] border border-slate-700 transition-colors cursor-pointer"
          >
            @{testUser}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Active User Card Result */}
      {userData && (
        <div className="bg-slate-950/80 border border-sky-500/20 rounded-lg p-3 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* Avatar thumbnail preview */}
            <div className="relative w-14 h-14 rounded-lg bg-slate-900 border border-sky-500/40 overflow-hidden flex items-center justify-center shrink-0">
              {typeLoading ? (
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
              ) : activeAvatarPreview ? (
                <img
                  src={activeAvatarPreview}
                  alt={userData.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <UserCheck className="w-6 h-6 text-slate-600" />
              )}
            </div>

            {/* Profile Information */}
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-white truncate">
                  {userData.displayName}
                </span>
                {userData.hasVerifiedBadge && (
                  <span title="Roblox Verified">
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                <span>@{userData.name}</span>
                <span className="text-slate-600">•</span>
                <span className="text-sky-300">ID: {userData.id}</span>
              </div>
              {userData.created && (
                <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-0.5">
                  <Calendar className="w-3 h-3" />
                  <span>Joined {new Date(userData.created).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* View on Roblox link */}
            <a
              href={`https://www.roblox.com/users/${userData.id}/profile`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Open Roblox Profile"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {/* Avatar Render View Selector */}
          <div className="border-t border-slate-800/80 pt-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 flex items-center gap-1 font-medium">
                <Camera className="w-3 h-3 text-sky-400" />
                <span>Card Avatar Render Mode:</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                Auto-Synced to ID Card
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleSwitchAvatarType('avatar')}
                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer text-center ${
                  activeAvatarType === 'avatar'
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                3D Full Body
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAvatarType('avatar-bust')}
                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer text-center ${
                  activeAvatarType === 'avatar-bust'
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Bust / Torso
              </button>
              <button
                type="button"
                onClick={() => handleSwitchAvatarType('avatar-headshot')}
                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer text-center ${
                  activeAvatarType === 'avatar-headshot'
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Headshot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
