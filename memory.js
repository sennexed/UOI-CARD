import fs from 'fs';
import path from 'path';

// ========================================================
// PERMANENT SERVER MEMORY & SETUP REGISTRY
// ========================================================
const DATA_DIR = path.join(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'server_memory.json');
const BACKUP_FILE = path.join(DATA_DIR, 'server_memory.backup.json');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

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
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
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
 * Load server memory with backup fallback and cross-database reconciliation
 */
export function loadServerMemory() {
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

  return memory;
}

/**
 * Save server memory atomically and duplicate to backup file & cards.json
 */
export function saveServerMemory(memory) {
  ensureDataDir();
  memory.lastUpdated = new Date().toISOString();

  // Write primary memory file
  atomicWriteJson(MEMORY_FILE, memory);
  // Write backup memory file
  atomicWriteJson(BACKUP_FILE, memory);

  // Sync setup into cards.json to keep both stores in 100% parity
  try {
    let cardsDb = { cards: {}, serToUser: {}, guilds: {}, pendingRequests: {} };
    if (fs.existsSync(CARDS_FILE)) {
      try {
        cardsDb = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
      } catch (_) {}
    }
    cardsDb.guilds = cardsDb.guilds || {};
    for (const [gId, sRec] of Object.entries(memory.servers || {})) {
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
}

/**
 * Smart channel finder to save time during setup
 */
export function findBestStaffChannel(guild) {
  if (!guild || !guild.channels || !guild.channels.cache) return null;

  const channels = Array.from(guild.channels.cache.values()).filter(
    (c) => c.isTextBased && c.isTextBased() && !c.isVoiceBased?.()
  );

  // High priority keywords for card staff review
  const priorityPatterns = [
    /card[-_]?review/i,
    /id[-_]?review/i,
    /card[-_]?apps/i,
    /id[-_]?cards/i,
    /staff[-_]?review/i,
    /applications/i,
    /staff[-_]?commands/i,
    /mod[-_]?logs/i,
    /bot[-_]?commands/i,
    /staff/i,
    /admin/i,
    /general/i,
  ];

  for (const pattern of priorityPatterns) {
    const found = channels.find((c) => pattern.test(c.name));
    if (found) return found;
  }

  // Fallback to system channel if available
  if (guild.systemChannel) return guild.systemChannel;

  // Fallback to first text channel bot can write to
  return channels[0] || null;
}

/**
 * Auto-detect and record server setup to save time
 */
export function autoDetectAndSaveSetup(guild, currentChannel = null) {
  if (!guild) return null;
  const memory = loadServerMemory();
  const existing = memory.servers[guild.id];

  // If already has explicit valid setup, preserve it
  if (existing && existing.setup && existing.setup.isSetup && existing.setup.staffChannelId) {
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
  if (!guild || !guild.id) return null;
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
