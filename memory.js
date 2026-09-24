import fs from 'fs';
import path from 'path';

// ========================================================
// PERMANENT SERVER MEMORY & SETUP REGISTRY (OPTIMIZED IN-MEMORY CACHE)
// ========================================================
const DATA_DIR = path.join(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'server_memory.json');
const BACKUP_FILE = path.join(DATA_DIR, 'server_memory.backup.json');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

let _cachedMemory = null;
let _saveTimeout = null;
let _isDirty = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (_) {}
  }
}

// Atomic file write using temporary swap file to prevent corruption
function atomicWriteJson(filePath, data) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error(`[UOI Bot] Error atomic-writing ${path.basename(filePath)}:`, err.message);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
    return false;
  }
}

/**
 * Load server memory with backup fallback and cross-database reconciliation.
 * Uses high-speed in-memory cache for instant O(1) reads.
 */
export function loadServerMemory(forceReload = false) {
  if (_cachedMemory && !forceReload) {
    return _cachedMemory;
  }

  ensureDataDir();
  let memory = { version: 1, lastUpdated: new Date().toISOString(), servers: {} };

  // 1. Try reading primary memory file
  let loaded = false;
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.servers === 'object') {
        memory = parsed;
        delete memory.servers['undefined'];
        loaded = true;
      }
    } catch (err) {
      console.warn('[UOI Bot] Primary server_memory.json read error, checking backup...', err.message);
    }
  }

  // 2. Try fallback backup file if primary failed
  if (!loaded && fs.existsSync(BACKUP_FILE)) {
    try {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.servers === 'object') {
        memory = parsed;
        loaded = true;
        console.log('[UOI Bot] ♻️ Successfully restored server memory from backup file.');
      }
    } catch (_) {}
  }

  // 3. Cross-reconcile with legacy cards.json guilds field
  if (fs.existsSync(CARDS_FILE)) {
    try {
      const rawCards = fs.readFileSync(CARDS_FILE, 'utf8');
      const parsedCards = JSON.parse(rawCards);
      if (parsedCards.guilds && typeof parsedCards.guilds === 'object') {
        for (const [gId, gConfig] of Object.entries(parsedCards.guilds)) {
          if (!memory.servers[gId]) {
            memory.servers[gId] = {
              guildId: gId,
              name: gConfig.name || `Server ${gId}`,
              iconUrl: null,
              ownerId: null,
              memberCount: 0,
              firstSeen: gConfig.setupAt || new Date().toISOString(),
              lastSeen: new Date().toISOString(),
              isCurrentlyPresent: true,
              setup: {
                isSetup: !!gConfig.isSetup,
                autoConfigured: !!gConfig.autoConfigured,
                staffChannelId: gConfig.staffChannelId || null,
                staffChannelName: gConfig.staffChannelName || null,
                deliveryChannelId: gConfig.deliveryChannelId || null,
                deliveryChannelName: gConfig.deliveryChannelName || null,
                staffRoleId: gConfig.staffRoleId || null,
                staffRoleName: gConfig.staffRoleName || null,
                autoNickname: gConfig.autoNickname ?? true,
                setupAt: gConfig.setupAt || new Date().toISOString(),
                setupBy: gConfig.setupBy || null,
              },
            };
          } else if (!memory.servers[gId].setup || !memory.servers[gId].setup.isSetup) {
            memory.servers[gId].setup = {
              ...memory.servers[gId].setup,
              ...gConfig,
              isSetup: !!gConfig.isSetup,
            };
          }
        }
      }
    } catch (_) {}
  }

  _cachedMemory = memory;
  return memory;
}

/**
 * Flush cached memory state synchronously to disk (used on clean shutdown)
 */
export function flushMemorySync() {
  if (!_cachedMemory || !_isDirty) return;
  _cachedMemory.lastUpdated = new Date().toISOString();
  atomicWriteJson(MEMORY_FILE, _cachedMemory);
  atomicWriteJson(BACKUP_FILE, _cachedMemory);
  _isDirty = false;
}

// Auto-flush on process termination
try {
  process.on('beforeExit', flushMemorySync);
  process.on('SIGINT', () => { flushMemorySync(); process.exit(0); });
  process.on('SIGTERM', () => { flushMemorySync(); process.exit(0); });
} catch (_) {}

/**
 * Save server memory atomically and duplicate to backup file & cards.json
 * Updates memory in O(1) time and batches disk persistence to maintain ultra-fast responsiveness.
 */
export function saveServerMemory(memory) {
  _cachedMemory = memory;
  _cachedMemory.lastUpdated = new Date().toISOString();
  _isDirty = true;

  // Immediate debounced atomic write (50ms debounce for rapid operations)
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    ensureDataDir();
    atomicWriteJson(MEMORY_FILE, _cachedMemory);
    atomicWriteJson(BACKUP_FILE, _cachedMemory);
    _isDirty = false;

    // Sync setup into cards.json to keep both stores in 100% parity
    try {
      let cardsDb = { cards: {}, serToUser: {}, guilds: {}, pendingRequests: {} };
      if (fs.existsSync(CARDS_FILE)) {
        try {
          cardsDb = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
        } catch (_) {}
      }
      cardsDb.guilds = cardsDb.guilds || {};
      for (const [gId, sRec] of Object.entries(_cachedMemory.servers || {})) {
        if (sRec.setup) {
          cardsDb.guilds[gId] = {
            ...sRec.setup,
            name: sRec.name,
            guildId: gId,
          };
        }
      }
      atomicWriteJson(CARDS_FILE, cardsDb);
    } catch (syncErr) {
      console.warn('[UOI Bot] Notice during cards.json sync:', syncErr.message);
    }
  }, 50);
}

/**
 * Check if the bot has permission to view, send, and embed in a channel
 */
export function canBotPostInChannel(channel, guild = null) {
  if (!channel || !channel.isTextBased || !channel.isTextBased() || channel.isVoiceBased?.()) return false;
  const g = guild || channel.guild;
  const me = g?.members?.me;
  if (!me) return true;
  const perms = channel.permissionsFor ? channel.permissionsFor(me) : null;
  if (!perms) return false;
  return (
    perms.has('ViewChannel') &&
    perms.has('SendMessages') &&
    perms.has('EmbedLinks')
  );
}

/**
 * Smart channel finder to save time during setup with verified bot permissions
 */
export function findBestStaffChannel(guild) {
  if (!guild || !guild.channels || !guild.channels.cache) return null;

  const allTextChannels = Array.from(guild.channels.cache.values()).filter(
    (c) => c.isTextBased && c.isTextBased() && !c.isVoiceBased?.()
  );

  // Filter channels to only text channels where the bot ACTUALLY has View, Send, and Embed permissions
  const channels = allTextChannels.filter((c) => canBotPostInChannel(c, guild));
  const pool = channels.length > 0 ? channels : allTextChannels;

  // High priority keywords for card staff review (Staff chat & review channels prioritized over audit logs)
  const priorityPatterns = [
    /card[-_]?review/i,
    /id[-_]?review/i,
    /card[-_]?apps/i,
    /id[-_]?cards/i,
    /staff[-_]?review/i,
    /staff[-_]?chat/i,
    /staff/i,
    /mod[-_]?chat/i,
    /officer/i,
    /admin/i,
    /applications/i,
    /staff[-_]?commands/i,
    /bot[-_]?commands/i,
    /general/i,
    /mod[-_]?logs/i,
  ];

  for (const pattern of priorityPatterns) {
    const found = pool.find((c) => pattern.test(c.name));
    if (found) return found;
  }

  // Fallback to system channel if writable by bot
  if (guild.systemChannel && canBotPostInChannel(guild.systemChannel, guild)) {
    return guild.systemChannel;
  }

  // Fallback to first channel in pool
  return pool[0] || null;
}

/**
 * Auto-detect and record server setup to save time with self-healing
 */
export function autoDetectAndSaveSetup(guild, currentChannel = null) {
  if (!guild || !guild.id || guild.id === 'undefined') return null;
  const memory = loadServerMemory();
  const existing = memory.servers[guild.id];

  // If already has setup, check if the configured staff channel is valid and accessible
  if (existing && existing.setup && existing.setup.isSetup && existing.setup.staffChannelId) {
    const currentStaffChannel = guild.channels?.cache?.get ? guild.channels.cache.get(existing.setup.staffChannelId) : null;
    // If the channel exists and the bot can post in it, keep it
    if (currentStaffChannel && canBotPostInChannel(currentStaffChannel, guild)) {
      return existing.setup;
    }
    // If it was auto-configured or channel is missing/inaccessible, self-heal to best available channel!
    if (existing.setup.autoConfigured || !currentStaffChannel) {
      const healedChannel = findBestStaffChannel(guild) || currentChannel;
      if (healedChannel && healedChannel.id !== existing.setup.staffChannelId) {
        console.log(`[UOI Bot] 🔄 Auto-healing staff review channel for "${guild.name}": #${existing.setup.staffChannelName} -> #${healedChannel.name}`);
        existing.setup.staffChannelId = healedChannel.id;
        existing.setup.staffChannelName = healedChannel.name;
        recordServer(guild, existing.setup);
        return existing.setup;
      }
    }
    return existing.setup;
  }

  const staffChannel = findBestStaffChannel(guild) || currentChannel;
  const channelId = staffChannel ? staffChannel.id : (currentChannel ? currentChannel.id : null);
  const channelName = staffChannel ? staffChannel.name : (currentChannel ? currentChannel.name : 'general');

  const setupData = {
    isSetup: true,
    autoConfigured: true,
    staffChannelId: channelId,
    staffChannelName: channelName,
    deliveryChannelId: null,
    deliveryChannelName: null,
    staffRoleId: null,
    staffRoleName: null,
    autoNickname: true,
    setupAt: new Date().toISOString(),
    setupBy: {
      discordId: 'SYSTEM',
      discordTag: 'Smart Zero-Config Setup',
    },
  };

  recordServer(guild, setupData);
  console.log(`[UOI Bot] ⚡ Auto-configured zero-config setup for server "${guild.name}" (${guild.id}) -> #${channelName}`);
  return setupData;
}

/**
 * Record a server into permanent memory
 */
export function recordServer(guild, explicitSetup = null) {
  if (!guild || !guild.id || guild.id === 'undefined') return null;
  const memory = loadServerMemory();
  const now = new Date().toISOString();

  let existing = memory.servers[guild.id];
  if (!existing) {
    existing = {
      guildId: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL?.() || null,
      ownerId: guild.ownerId || null,
      memberCount: guild.memberCount || 0,
      firstSeen: now,
      lastSeen: now,
      isCurrentlyPresent: true,
      setup: {
        isSetup: false,
        autoConfigured: false,
        staffChannelId: null,
        staffChannelName: null,
        deliveryChannelId: null,
        deliveryChannelName: null,
        staffRoleId: null,
        staffRoleName: null,
        autoNickname: true,
        setupAt: null,
        setupBy: null,
      },
      stats: {
        cardsIssued: 0,
        totalApplications: 0,
      },
    };
  } else {
    existing.name = guild.name || existing.name;
    existing.iconUrl = guild.iconURL?.() || existing.iconUrl;
    existing.ownerId = guild.ownerId || existing.ownerId;
    existing.memberCount = guild.memberCount || existing.memberCount;
    existing.lastSeen = now;
    existing.isCurrentlyPresent = true;
  }

  // Update setup if provided or run smart discovery
  if (explicitSetup) {
    existing.setup = {
      ...existing.setup,
      ...explicitSetup,
      isSetup: true,
    };
  } else if (!existing.setup || !existing.setup.isSetup || !existing.setup.staffChannelId) {
    const discovered = findBestStaffChannel(guild);
    if (discovered) {
      existing.setup = {
        isSetup: true,
        autoConfigured: true,
        staffChannelId: discovered.id,
        staffChannelName: discovered.name,
        deliveryChannelId: null,
        deliveryChannelName: null,
        staffRoleId: null,
        staffRoleName: null,
        autoNickname: true,
        setupAt: now,
        setupBy: { discordId: 'SYSTEM', discordTag: 'Auto-Discovery' },
      };
    }
  }

  memory.servers[guild.id] = existing;
  saveServerMemory(memory);
  return existing;
}

/**
 * Update server when removed/kicked, retaining all setup & card data permanently
 */
export function markServerLeft(guildId) {
  const memory = loadServerMemory();
  if (memory.servers[guildId]) {
    memory.servers[guildId].isCurrentlyPresent = false;
    memory.servers[guildId].leftAt = new Date().toISOString();
    saveServerMemory(memory);
    console.log(`[UOI Bot] 🧠 Preserved permanent memory for departed server ID: ${guildId}`);
  }
}

/**
 * Get a specific server from permanent memory
 */
export function getServerRecord(guildId) {
  const memory = loadServerMemory();
  return memory.servers[guildId] || null;
}

/**
 * Get summary of all servers in permanent memory
 */
export function getAllServerRecords() {
  const memory = loadServerMemory();
  return Object.values(memory.servers || {});
}

/**
 * Sync and reconcile all guilds currently visible to the Discord client
 */
export async function syncGuildsMemory(client) {
  if (!client || !client.guilds) return;
  try {
    const guilds = await client.guilds.fetch();
    let setupCount = 0;
    for (const [guildId, oauthGuild] of guilds) {
      try {
        const fullGuild = await oauthGuild.fetch();
        const record = recordServer(fullGuild);
        if (record && record.setup && record.setup.isSetup) {
          setupCount++;
        }
      } catch (err) {
        // Fallback with minimal info
        recordServer({ id: guildId, name: oauthGuild.name });
      }
    }
    const all = getAllServerRecords();
    console.log(`[UOI Bot] 🧠 Permanent Memory Synchronized: ${all.length} total servers remembered (${setupCount} active setups configured).`);
  } catch (err) {
    console.warn('[UOI Bot] Notice during guild memory sync:', err.message);
  }
}
