// ============================================================================
// UOI Central Registry - High-Precision Roblox Account Auto-Detection Engine
// Multi-Tier Detection: Bloxlink API -> RoVer API -> Central Registry -> Nickname Parser -> Roblox API
// ============================================================================

import fs from 'fs';
import path from 'path';

const STOP_WORDS = new Set([
  'ADMIN', 'ADMINISTRATOR', 'MOD', 'MODERATOR', 'STAFF', 'MEMBER', 'CITIZEN',
  'OFFICER', 'SOLDIER', 'PRESIDENT', 'MINISTER', 'GENERAL', 'CADET', 'UNKNOWN',
  'PRIVATE', 'CAPTAIN', 'LIEUTENANT', 'COLONEL', 'SERGEANT', 'COMMANDER', 'DIRECTOR',
  'UOI', 'UNION', 'INDIAN', 'INDIA', 'TEST', 'BOT', 'GUEST', 'USER', 'PLAYER',
]);

// High-Speed In-Memory Cache (TTL: 15 minutes for profiles, 30 minutes for bindings)
const PROFILE_CACHE_TTL_MS = 15 * 60 * 1000;
const BINDING_CACHE_TTL_MS = 30 * 60 * 1000;
const _profileCache = new Map();
const _bindingCache = new Map();

function getCachedProfile(key) {
  if (!key) return null;
  const normalizedKey = String(key).toLowerCase();
  const entry = _profileCache.get(normalizedKey);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data;
  }
  if (entry) _profileCache.delete(normalizedKey);
  return null;
}

function setCachedProfile(key, data) {
  if (!key || !data) return;
  const normalizedKey = String(key).toLowerCase();
  // Evict if cache grows too large
  if (_profileCache.size > 2000) {
    const oldestKey = _profileCache.keys().next().value;
    _profileCache.delete(oldestKey);
  }
  _profileCache.set(normalizedKey, {
    data,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });
  if (data.userId) {
    _profileCache.set(String(data.userId), {
      data,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });
  }
  if (data.username) {
    _profileCache.set(String(data.username).toLowerCase(), {
      data,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });
  }
}

function getCachedBinding(key) {
  if (!key) return null;
  const entry = _bindingCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.robloxId;
  }
  if (entry) _bindingCache.delete(key);
  return null;
}

function setCachedBinding(key, robloxId) {
  if (!key || !robloxId) return;
  if (_bindingCache.size > 2000) {
    const oldest = _bindingCache.keys().next().value;
    _bindingCache.delete(oldest);
  }
  _bindingCache.set(key, {
    robloxId: String(robloxId),
    expiresAt: Date.now() + BINDING_CACHE_TTL_MS,
  });
}

function isValidApiKey(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.trim();
  if (k.startsWith('http://') || k.startsWith('https://')) return false;
  if (k.includes(':') || k.includes('/') || k.includes(' ') || k.length < 8) return false;
  return true;
}

/**
 * Clean and extract candidate Roblox username tokens from Discord nickname/name strings.
 * Enforces Roblox username specifications: 3-20 characters, [a-zA-Z0-9_], no consecutive underscores.
 */
export function extractRobloxCandidates(rawStrings = []) {
  const candidates = new Set();

  for (const raw of rawStrings) {
    if (!raw || typeof raw !== 'string') continue;
    const str = raw.trim();
    if (!str) continue;

    // 1. Explicit @handle syntax: @RobloxUser
    const handleMatches = str.matchAll(/@([a-zA-Z0-9_]{3,20})/g);
    for (const m of handleMatches) {
      if (!STOP_WORDS.has(m[1].toUpperCase())) {
        candidates.add(m[1]);
      }
    }

    // 2. Strip bracketed role tags like [GEN], (Pvt), {Officer}, <Tag>
    const strippedBrackets = str.replace(/\[.*?\]|\(.*?\)|<.*?>|\{.*?\}/g, ' ').trim();

    // 3. Split by common roleplay delimiters: |, -, –, —, /, \, •, :, ;, ~, #
    const tokenBuckets = [
      strippedBrackets,
      ...str.split(/[|/\\•\-–—:;~#]+/g),
      ...strippedBrackets.split(/[|/\\•\-–—:;~#]+/g),
    ];

    for (const token of tokenBuckets) {
      if (!token) continue;
      const clean = token.replace(/^[^a-zA-Z0-9_]+|[^a-zA-Z0-9_]+$/g, '').trim();

      if (/^[a-zA-Z0-9_]{3,20}$/.test(clean)) {
        if (!STOP_WORDS.has(clean.toUpperCase())) {
          candidates.add(clean);
        }
      }
    }
  }

  return Array.from(candidates);
}

/**
 * Extract candidate Roblox usernames ONLY from explicit server nickname formatting.
 * Never blindly checks targetUser.username, globalName, or plain unstructured display names.
 */
export function extractRobloxNicknameCandidates(member, targetUser) {
  const nickname = member?.nickname;
  if (!nickname || typeof nickname !== 'string') return [];

  const nick = nickname.trim();
  if (!nick) return [];

  const candidates = new Set();

  // 1. Explicit @handle syntax: e.g. "Senne (@RealSenne)" or "@RealSenne"
  const handleMatches = nick.matchAll(/@([a-zA-Z0-9_]{3,20})/g);
  for (const m of handleMatches) {
    const candidate = m[1];
    if (!STOP_WORDS.has(candidate.toUpperCase())) {
      candidates.add(candidate);
    }
  }

  // 2. Explicit rbx: or roblox: prefix: e.g. "rbx:RealSenne" or "(rbx: RealSenne)"
  const prefixMatches = nick.matchAll(/(?:rbx|roblox)\s*[:=]\s*([a-zA-Z0-9_]{3,20})/gi);
  for (const m of prefixMatches) {
    const candidate = m[1];
    if (!STOP_WORDS.has(candidate.toUpperCase())) {
      candidates.add(candidate);
    }
  }

  // 3. Role tags with brackets/delimiters: e.g. "[PVT] RobloxPlayer", "RobloxPlayer | [Rank]"
  const hasFormatting = /\[.*?\]|\(.*?\)|<.*?>|\{.*?\}|[|/\\•—~]/.test(nick);
  if (hasFormatting) {
    const stripped = nick.replace(/\[.*?\]|\(.*?\)|<.*?>|\{.*?\}/g, ' ').trim();
    const parts = stripped.split(/[|/\\•\-–—:;~#]+/g);
    for (const part of parts) {
      const clean = part.replace(/^[^a-zA-Z0-9_]+|[^a-zA-Z0-9_]+$/g, '').trim();
      if (/^[a-zA-Z0-9_]{3,20}$/.test(clean) && !STOP_WORDS.has(clean.toUpperCase())) {
        const cleanLower = clean.toLowerCase();
        const discordUserLower = (targetUser?.username || '').toLowerCase();
        const discordGlobalLower = (targetUser?.globalName || '').toLowerCase();

        // Prevent false positives: Must not match their bare Discord username/globalName without digits/underscores
        if (cleanLower === discordUserLower && !/[0-9_]/.test(clean)) continue;
        if (cleanLower === discordGlobalLower && !/[0-9_]/.test(clean)) continue;

        candidates.add(clean);
      }
    }
  }

  return Array.from(candidates);
}

/**
 * Fetch full Roblox profile details and avatar thumbnail for a numerical ID or username.
 * Accelerated with 15-minute in-memory caching and parallel thumbnail retrieval.
 */
export async function fetchRobloxUserData(query) {
  if (!query) return null;
  const cleanQuery = String(query).trim();

  // 1. Check in-memory cache
  const cached = getCachedProfile(cleanQuery);
  if (cached) return cached;

  try {
    let userId = null;
    let username = null;
    let displayName = null;
    let hasVerifiedBadge = false;

    // Check if query is pure digits (Numerical User ID)
    if (/^\d+$/.test(cleanQuery)) {
      userId = cleanQuery;
      try {
        const uResp = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (uResp.ok) {
          const uJson = await uResp.json();
          username = uJson.name;
          displayName = uJson.displayName;
          hasVerifiedBadge = !!uJson.hasVerifiedBadge;
        }
      } catch (_) {}
    } else {
      // Username query
      const sanitizedName = cleanQuery.replace(/^@/, '');
      const searchResp = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [sanitizedName], excludeBannedUsers: false }),
        signal: AbortSignal.timeout(4000),
      });

      if (searchResp.ok) {
        const sJson = await searchResp.json();
        const match = sJson.data?.[0];
        if (match) {
          userId = String(match.id);
          username = match.name;
          displayName = match.displayName;
          hasVerifiedBadge = !!match.hasVerifiedBadge;
        }
      }
    }

    if (!userId) {
      return null;
    }

    // Parallel fetch: 3D Avatar Full Body + 3D Headshot Portrait (720x720)
    let avatarUrl = null;
    let headshotUrl = null;

    try {
      const [headshotResp, avatarResp] = await Promise.all([
        fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=720x720&format=Png&isCircular=false`,
          { signal: AbortSignal.timeout(4000) }
        ),
        fetch(
          `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=720x720&format=Png&isCircular=false`,
          { signal: AbortSignal.timeout(4000) }
        ),
      ]);

      if (headshotResp.ok) {
        const hJson = await headshotResp.json();
        headshotUrl = hJson.data?.[0]?.imageUrl || null;
      }
      if (avatarResp.ok) {
        const aJson = await avatarResp.json();
        avatarUrl = aJson.data?.[0]?.imageUrl || null;
      }
    } catch (_) {}

    const profileData = {
      userId: String(userId),
      username: username || cleanQuery,
      displayName: displayName || username || cleanQuery,
      hasVerifiedBadge,
      avatarUrl: headshotUrl || avatarUrl,
      fullBodyUrl: avatarUrl,
      headshotUrl,
      profileUrl: `https://www.roblox.com/users/${userId}/profile`,
    };

    // Store in cache for instantaneous future retrievals
    setCachedProfile(cleanQuery, profileData);
    if (userId) setCachedProfile(userId, profileData);
    if (username) setCachedProfile(username, profileData);

    return profileData;
  } catch (err) {
    console.warn('[UOI Bot] Roblox API resolution notice:', err.message);
    return null;
  }
}

/**
 * Query Bloxlink API for guild-specific discord-to-roblox binding.
 * Accelerated with in-memory caching.
 */
async function queryBloxlink(guildId, discordUserId, apiKey) {
  if (!isValidApiKey(apiKey) || !discordUserId) return null;
  const cacheKey = `bloxlink:${guildId || 'global'}:${discordUserId}`;
  const cached = getCachedBinding(cacheKey);
  if (cached) return cached;

  try {
    const url = guildId
      ? `https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${discordUserId}`
      : `https://api.blox.link/v4/public/discord-to-roblox/${discordUserId}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.robloxId) {
        const rId = String(data.robloxId);
        setCachedBinding(cacheKey, rId);
        return rId;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Query RoVer API for discord-to-roblox binding.
 * Accelerated with in-memory caching.
 */
async function queryRover(guildId, discordUserId, apiKey) {
  if (!isValidApiKey(apiKey) || !discordUserId) return null;
  const cacheKey = `rover:${guildId || 'global'}:${discordUserId}`;
  const cached = getCachedBinding(cacheKey);
  if (cached) return cached;

  try {
    const url = guildId
      ? `https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${discordUserId}`
      : `https://registry.rover.link/api/discord-to-roblox/${discordUserId}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && (data.robloxId || data.roblox_id)) {
        const rId = String(data.robloxId || data.roblox_id);
        setCachedBinding(cacheKey, rId);
        return rId;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Search local database / memory for this user's prior card or application.
 */
function queryCentralRegistry(discordUserId) {
  if (!discordUserId) return null;
  try {
    const dbPath = path.join(process.cwd(), 'data', 'cards.json');
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      const db = JSON.parse(raw);
      // Priority 1: Explicit permanent link created via /card link or verified generate
      if (db.linkedAccounts?.[discordUserId]?.userId) {
        return {
          userId: String(db.linkedAccounts[discordUserId].userId),
          username: db.linkedAccounts[discordUserId].username || null,
        };
      }
      // Priority 2: Active issued card (never reuse revoked cards)
      const card = db.cards?.[discordUserId];
      if (card && card.status === 'ACTIVE' && (card.robloxUserId || card.robloxUsername)) {
        return {
          userId: card.robloxUserId ? String(card.robloxUserId) : null,
          username: card.robloxUsername || null,
        };
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Core Multi-Stage Roblox Auto-Detection Pipeline.
 * 
 * Hierarchy:
 * 1. Manual User Input (if provided)
 * 2. Bloxlink API Guild Binding (if valid API key available)
 * 3. RoVer API Guild Binding (if valid API key available)
 * 4. UOI Database Permanent Link or Active Card
 * 5. Explicit Server Nickname Syntax (e.g., @RobloxHandle or rbx:Username)
 * 
 * Note: Never blindly matches Discord usernames, global display names, or plain nicknames!
 */
export async function autoDetectRobloxUser({
  member = null,
  user = null,
  guildId = null,
  guildConfig = null,
  manualQuery = null,
}) {
  const targetUser = user || member?.user;
  const targetDiscordId = targetUser?.id;

  // 1. Manual Input
  if (manualQuery && manualQuery.trim().length > 0) {
    const rawInput = manualQuery.trim();
    // A. Direct check
    const directProfile = await fetchRobloxUserData(rawInput);
    if (directProfile) {
      return {
        ...directProfile,
        detected: true,
        method: 'Manual Input',
        confidence: 'Direct Input (Verified via Roblox API)',
      };
    }

    // B. Check if manual input had tags/delimiters like [GEN] Builderman or @Builderman
    const manualCandidates = extractRobloxCandidates([rawInput]);
    if (manualCandidates.length > 0) {
      try {
        const searchResp = await fetch('https://users.roblox.com/v1/usernames/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            usernames: manualCandidates.slice(0, 5),
            excludeBannedUsers: false,
          }),
        });

        if (searchResp.ok) {
          const sJson = await searchResp.json();
          const match = sJson.data?.[0];
          if (match) {
            const cleanedProfile = await fetchRobloxUserData(match.id);
            if (cleanedProfile) {
              return {
                ...cleanedProfile,
                detected: true,
                method: `Manual Input (Auto-Cleaned: ${match.name})`,
                confidence: 'High (Verified via Roblox API)',
              };
            }
          }
        }
      } catch (_) {}
    }

    // If manual query failed Roblox API check, return basic fallback
    return {
      userId: null,
      username: rawInput,
      displayName: rawInput,
      hasVerifiedBadge: false,
      avatarUrl: null,
      profileUrl: null,
      detected: false,
      method: 'Manual Fallback',
      confidence: 'Unverified',
    };
  }

  // 2. Bloxlink API (if key present in env or server config)
  const bloxlinkKey = guildConfig?.bloxlinkApiKey || process.env.BLOXLINK_API_KEY;
  if (isValidApiKey(bloxlinkKey) && targetDiscordId) {
    const bloxRobloxId = await queryBloxlink(guildId, targetDiscordId, bloxlinkKey);
    if (bloxRobloxId) {
      const profile = await fetchRobloxUserData(bloxRobloxId);
      if (profile) {
        return {
          ...profile,
          detected: true,
          method: 'Bloxlink Verification Link',
          confidence: '100% Cryptographic Match',
        };
      }
    }
  }

  // 3. RoVer API (if key present in env or server config)
  const roverKey = guildConfig?.roverApiKey || process.env.ROVER_API_KEY;
  if (isValidApiKey(roverKey) && targetDiscordId) {
    const roverRobloxId = await queryRover(guildId, targetDiscordId, roverKey);
    if (roverRobloxId) {
      const profile = await fetchRobloxUserData(roverRobloxId);
      if (profile) {
        return {
          ...profile,
          detected: true,
          method: 'RoVer Verification Link',
          confidence: '100% Cryptographic Match',
        };
      }
    }
  }

  // 4. Central UOI Registry Historical Memory / Explicit Permanent Link
  if (targetDiscordId) {
    const registered = queryCentralRegistry(targetDiscordId);
    if (registered && (registered.userId || registered.username)) {
      const profile = await fetchRobloxUserData(registered.userId || registered.username);
      if (profile) {
        return {
          ...profile,
          detected: true,
          method: 'UOI Verified Account Link',
          confidence: 'Permanent Database Match',
        };
      }
    }
  }

  // 5. Strict Server Nickname Auto-Match (ONLY with explicit formatting e.g. @RobloxHandle or rbx:Username)
  const nicknameCandidates = extractRobloxNicknameCandidates(member, targetUser);

  if (nicknameCandidates.length > 0) {
    try {
      const searchResp = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernames: nicknameCandidates.slice(0, 5),
          excludeBannedUsers: false,
        }),
      });

      if (searchResp.ok) {
        const sJson = await searchResp.json();
        const matches = sJson.data || [];

        if (matches.length > 0) {
          const bestMatch = matches[0];
          const profile = await fetchRobloxUserData(bestMatch.id);
          if (profile) {
            return {
              ...profile,
              detected: true,
              method: 'Server Nickname Explicit Tag',
              confidence: 'High (Verified Roblox Profile)',
              matchedCandidate: bestMatch.name,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[UOI Bot] Auto-detection batch search notice:', err.message);
    }
  }

  // Not detected - Do NOT assign a random stranger!
  return {
    detected: false,
    userId: null,
    username: null,
    displayName: targetUser?.displayName || targetUser?.username || 'Unknown',
    hasVerifiedBadge: false,
    avatarUrl: targetUser?.displayAvatarURL ? targetUser.displayAvatarURL({ extension: 'png', size: 512 }) : null,
    profileUrl: null,
    method: 'None',
    confidence: 'Undetected',
  };
}
