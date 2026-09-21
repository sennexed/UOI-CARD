import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  REST,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import {
  loadServerMemory,
  saveServerMemory,
  recordServer,
  autoDetectAndSaveSetup,
  getServerRecord,
  getAllServerRecords,
} from '../memory.js';

// High-Performance Native Canvas Engine (@napi-rs/canvas backed by Skia)
let createCanvas = null;
let loadImage = null;
let canvasEngineName = 'Safe Fallback (Embed Only)';
let canvasFeatures = {
  engine: 'none',
  skiaAccelerated: false,
  fontsLoaded: 0,
  highQualitySmoothing: false,
};

try {
  const napi = await import('@napi-rs/canvas');
  createCanvas = napi?.createCanvas || napi?.default?.createCanvas || null;
  loadImage = napi?.loadImage || napi?.default?.loadImage || null;

  if (typeof createCanvas === 'function' && typeof loadImage === 'function') {
    canvasEngineName = '@napi-rs/canvas (Rust / Skia Engine)';
    canvasFeatures.engine = '@napi-rs/canvas';
    canvasFeatures.skiaAccelerated = true;
    canvasFeatures.highQualitySmoothing = true;

    // Load available system fonts into Skia's GlobalFonts table
    const globalFonts = napi.GlobalFonts || napi.default?.GlobalFonts;
    if (globalFonts) {
      try {
        if (typeof globalFonts.loadSystemFonts === 'function') {
          globalFonts.loadSystemFonts();
        }
        canvasFeatures.fontsLoaded = Array.isArray(globalFonts.families) ? globalFonts.families.length : 0;
      } catch (_) {}
    }
  }
} catch (_) {}

// Secondary fallback: node-canvas if available in environment
if (!createCanvas || typeof createCanvas !== 'function') {
  try {
    const nodeCanvas = await import('canvas');
    createCanvas = nodeCanvas?.createCanvas || nodeCanvas?.default?.createCanvas || null;
    loadImage = nodeCanvas?.loadImage || nodeCanvas?.default?.loadImage || null;
    if (typeof createCanvas === 'function') {
      canvasEngineName = 'node-canvas (Cairo)';
      canvasFeatures.engine = 'node-canvas';
      canvasFeatures.skiaAccelerated = false;
    }
  } catch (_) {}
}

if (createCanvas && typeof createCanvas === 'function') {
  console.log(`[UOI Bot] 🎨 Best canvas engine initialized: ${canvasEngineName} (${canvasFeatures.fontsLoaded} font families registered)`);
} else {
  console.log('[UOI Bot] Notice: Native canvas engine running in safe fallback mode.');
}

export function getCanvasEngineInfo() {
  return {
    engine: canvasEngineName,
    available: typeof createCanvas === 'function' && typeof loadImage === 'function',
    features: canvasFeatures,
  };
}

// Ultra-safe loadImage wrapper that NEVER throws "loadImage is not a function"
async function safeLoadImage(source) {
  if (!source) return null;
  if (typeof loadImage !== 'function') return null;

  try {
    // 1. Buffer input
    if (Buffer.isBuffer(source)) {
      if (source.length === 0) return null;
      return await loadImage(source);
    }

    // 2. HTTP/HTTPS URL input: fetch with timeout to avoid hanging Discord interactions
    if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(source, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) return null;
        const arrayBuffer = await resp.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        if (!buf || buf.length === 0) return null;
        return await loadImage(buf);
      } catch (_) {
        // Fallback to direct loadImage if fetch fails or aborts
        return await loadImage(source).catch(() => null);
      }
    }

    // 3. File path string input
    if (typeof source === 'string') {
      if (!fs.existsSync(source)) return null;
      const stat = fs.statSync(source);
      if (stat.size === 0) return null;
      return await loadImage(source);
    }

    return await loadImage(source);
  } catch (err) {
    console.warn('[UOI Bot] Safe image load notice:', err.message);
    return null;
  }
}

// Resilient pure-JS image dimension parser (works for PNG, JPEG, GIF, WebP without native binaries)
function getImageDimensions(buffer) {
  if (!buffer || buffer.length < 24) return { width: 1200, height: 900 };
  try {
    // 1. PNG signature: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width: width || 1200, height: height || 900 };
    }
    // 2. JPEG signature: FF D8
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width: width || 1200, height: height || 900 };
        }
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
    // 3. GIF signature: GIF87a or GIF89a
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width: width || 1200, height: height || 900 };
    }
    // 4. WebP signature: RIFF....WEBP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width: width || 1200, height: height || 900 };
      }
      if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width: width || 1200, height: height || 900 };
      }
    }
  } catch (_) {}
  return { width: 1200, height: 900 };
}

// ========================================================
// PERSISTENT DATABASE & TEMPLATE MANAGEMENT
// ========================================================
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
  let parsed = { cards: {}, serToUser: {}, guilds: {}, pendingRequests: {} };
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data.cards) parsed.cards = data.cards;
      if (data.serToUser) parsed.serToUser = data.serToUser;
      if (data.guilds) parsed.guilds = data.guilds;
      if (data.pendingRequests) parsed.pendingRequests = data.pendingRequests;
    }
  } catch (err) {
    console.error('[UOI Bot] Error reading database:', err.message);
  }

  // Cross-merge with permanent server memory so setups and servers are never lost
  try {
    const memory = loadServerMemory();
    for (const [gId, sRec] of Object.entries(memory.servers || {})) {
      if (sRec.setup && sRec.setup.isSetup) {
        parsed.guilds[gId] = {
          ...parsed.guilds[gId],
          ...sRec.setup,
          name: sRec.name || parsed.guilds[gId]?.name,
          guildId: gId,
        };
      }
    }
  } catch (_) {}

  return parsed;
}

function saveDatabase(db) {
  ensureDirectories();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[UOI Bot] Error saving database:', err.message);
  }

  // Sync guild configurations directly into permanent server memory
  try {
    const memory = loadServerMemory();
    let memoryChanged = false;
    for (const [gId, gConfig] of Object.entries(db.guilds || {})) {
      if (gConfig && gConfig.isSetup) {
        if (!memory.servers[gId]) {
          memory.servers[gId] = {
            guildId: gId,
            name: gConfig.name || `Server ${gId}`,
            firstSeen: gConfig.setupAt || new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            isCurrentlyPresent: true,
            setup: { ...gConfig },
          };
          memoryChanged = true;
        } else {
          memory.servers[gId].setup = {
            ...memory.servers[gId].setup,
            ...gConfig,
          };
          memoryChanged = true;
        }
      }
    }
    if (memoryChanged) {
      saveServerMemory(memory);
    }
  } catch (_) {}
}

// Helper: Resolve Roblox User info and Avatar URL
async function fetchRobloxUserData(query) {
  try {
    let userId = null;
    let username = null;
    let displayName = null;

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

// Helper: Find or download the active template (strictly 1 template per server)
async function resolveTemplateImage(guildId) {
  ensureDirectories();

  // 1. Server-specific template check (1 template per server)
  if (guildId) {
    const serverFiles = [
      path.join(TEMPLATES_DIR, `${guildId}.png`),
      path.join(TEMPLATES_DIR, `${guildId}.jpg`),
      path.join(TEMPLATES_DIR, `${guildId}.jpeg`),
    ];
    for (const f of serverFiles) {
      if (fs.existsSync(f)) {
        const img = await safeLoadImage(f);
        if (img) return { img, source: `Server Template (${guildId})`, filePath: f };
      }
    }
  }

  // 2. Global fallback candidates
  const candidateFiles = [
    'template.png',
    'template.jpg',
    'template.jpeg',
    './template.png',
    './template.jpg',
    'public/template.png',
    'public/template.jpg',
    path.join(TEMPLATES_DIR, 'default.png'),
  ];

  for (const filename of candidateFiles) {
    if (fs.existsSync(filename)) {
      const img = await safeLoadImage(filename);
      if (img) return { img, source: filename, filePath: filename };
    }
  }

  // 3. Environment URL check
  const envUrl = process.env.TEMPLATE_URL || process.env.CARD_TEMPLATE_URL;
  if (envUrl) {
    try {
      console.log(`[UOI Bot] Downloading template from TEMPLATE_URL: ${envUrl}`);
      const resp = await fetch(envUrl);
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync('template.png', buffer);
        const img = await safeLoadImage(buffer);
        if (img) return { img, source: 'TEMPLATE_URL (saved as template.png)', filePath: 'template.png' };
      }
    } catch (err) {
      console.warn('[UOI Bot] Failed to fetch TEMPLATE_URL:', err.message);
    }
  }

  return { img: null, source: null, filePath: null };
}

// Helper: Render official 1200x900 UOI Citizen ID Card
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
  if (!createCanvas || typeof createCanvas !== 'function') {
    return { buffer: null, usedTemplate: false, source: 'canvas-library-disabled' };
  }

  try {
    const canvas = createCanvas(1200, 900);
    const ctx = canvas.getContext('2d');

    // Enable best quality Skia rendering settings
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if ('textRendering' in ctx) {
      try { ctx.textRendering = 'optimizeLegibility'; } catch (_) {}
    }
    if ('patternQuality' in ctx) {
      try { ctx.patternQuality = 'best'; } catch (_) {}
    }

    const { img: templateImg, source: templateSource } = await resolveTemplateImage(guildId);
    const templateLoaded = !!templateImg;

    if (templateLoaded) {
      // 1. OFFICIAL PERMANENT TEMPLATE
      ctx.drawImage(templateImg, 0, 0, 1200, 900);

      // Top-Right Serial ID
      ctx.save();
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 14px "Nimbus Mono PS", "Liberation Mono", "Courier New", Courier, monospace';
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
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(rankBoxX, rankBoxY, rankBoxW, rankBoxH, 4);
      } else {
        ctx.rect(rankBoxX, rankBoxY, rankBoxW, rankBoxH);
      }
      ctx.fill();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 20px "Liberation Sans", "Nimbus Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(assignedRank.toUpperCase(), rankBoxX + rankBoxW / 2, rankBoxY + 31);
      ctx.textAlign = 'left';
      ctx.restore();

      // 5 Field Rows
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
      ctx.font = 'bold 22px "Liberation Sans", "Nimbus Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
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
        const avatarImg = await safeLoadImage(avatarUrl);
        if (avatarImg) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(photoX, photoY, photoW, photoH);
          ctx.clip();
          ctx.drawImage(avatarImg, photoX, photoY, photoW, photoH);
          ctx.restore();
        }
      }
    } else {
      // 2. FALLBACK DESIGN (Only if template image has not yet been set)
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
        { label: 'ROBLOX USERNAME', value: robloxUsername ? `@${robloxUsername}` : 'UNLINKED' },
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
        const avatarImg = await safeLoadImage(avatarUrl);
        if (avatarImg) {
          ctx.drawImage(avatarImg, 56, 260, 345, 380);
        }
      }
    }

    let buffer = null;
    if (typeof canvas.toBuffer === 'function') {
      buffer = canvas.toBuffer('image/png');
    } else if (typeof canvas.encode === 'function') {
      buffer = await canvas.encode('png');
    }

    return {
      buffer,
      usedTemplate: templateLoaded,
      source: templateSource,
    };
  } catch (renderErr) {
    console.error('[UOI Bot] Error during canvas rendering:', renderErr);
    return {
      buffer: null,
      usedTemplate: false,
      source: 'render-error: ' + renderErr.message,
    };
  }
}

export const cardCommand = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Official UOI Identification System')
    // 0. /card setup (Required initial configuration)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Configure UOI ID Card routing and review channels for this server (Admins Only)')
        .addChannelOption((opt) =>
          opt
            .setName('staff_channel')
            .setDescription('Staff channel where citizen card applications and approval requests are sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('delivery_channel')
            .setDescription('Channel where approved cards will be announced (Optional)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addRoleOption((opt) =>
          opt
            .setName('staff_role')
            .setDescription('Officer or staff role permitted to approve or decline cards (Optional)')
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('auto_nickname')
            .setDescription('Automatically update member nickname to "Name [Serial]" upon approval (Default: True)')
            .setRequired(false)
        )
    )
    // 1. /card generate (Routes to staff review)
    .addSubcommand((sub) =>
      sub
        .setName('generate')
        .setDescription('Submit application for official UOI ID card (Routes to Staff Review Queue)')
        .addStringOption((opt) =>
          opt.setName('roblox').setDescription('Roblox Username or numerical ID').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('fullname').setDescription('Full Citizen Name').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('gender').setDescription('Gender (Male / Female / Other)').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('rank').setDescription('Rank / Role (e.g. PRESIDENT, PRIME MINISTER, COMMUNITY MEMBER)')
        )
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member (leave empty to apply for yourself)')
        )
    )
    // 2. /card show (NEW: Pulls card of user from database)
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Display an official UOI ID card from the database')
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member to look up (leave empty to view your own card)')
        )
    )
    // 3. /card set-template (1 template per server)
    .addSubcommand((sub) =>
      sub
        .setName('set-template')
        .setDescription('Upload or update this server\'s official card template (1 per server)')
        .addAttachmentOption((opt) =>
          opt.setName('image').setDescription('Attach the official template image (PNG or JPG)')
        )
        .addStringOption((opt) =>
          opt.setName('url').setDescription('Or paste a direct image URL (Discord CDN, Imgur, etc.)')
        )
    )
    // 4. /card view-template
    .addSubcommand((sub) =>
      sub
        .setName('view-template')
        .setDescription('View the current active card template for this server')
    )
    // 5. /card verify [serial_id]
    .addSubcommand((sub) =>
      sub
        .setName('verify')
        .setDescription('Verify the authenticity of an issued UOI card serial ID in database')
        .addStringOption((opt) =>
          opt.setName('serial').setDescription('e.g. UOI-2026-839201').setRequired(true)
        )
    )
    // 6. /card inspect @user
    .addSubcommand((sub) =>
      sub
        .setName('inspect')
        .setDescription('Inspect citizen dossier, card status, and record history')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Target Discord user').setRequired(true)
        )
    )
    // 7. /card promote
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
    // 8. /card revoke
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
    )
    // 9. /card botstyle (Custom Bot Name Styles including 10th Font Sinistre)
    .addSubcommand((sub) =>
      sub
        .setName('botstyle')
        .setDescription('Apply or customize Discord bot name style with custom fonts and effects (Admins Only)')
        .addIntegerOption((opt) =>
          opt
            .setName('font')
            .setDescription('Choose font style (Default: Font 10 - Sinistre Vampyre)')
            .setRequired(false)
            .addChoices(
              { name: '🧛 Font 10: Sinistre (Vampyre / Gothic) [Requested]', value: 10 },
              { name: '👾 Font 8: Pixelify Sans (8-Bit Arcade)', value: 8 },
              { name: '🌸 Font 3: Cherry Bomb (Sakura)', value: 3 },
              { name: '🍬 Font 4: Chicle (Jellybean)', value: 4 },
              { name: '🌐 Font 6: MuseoModerno (Modern Geometric)', value: 6 },
              { name: '⚔️ Font 7: Neo-Castel (Medieval)', value: 7 },
              { name: '📜 Font 12: Zilla Slab (Tempo / Serif)', value: 12 },
              { name: '🔄 Font 11: GG Sans (Discord Default)', value: 11 }
            )
        )
        .addIntegerOption((opt) =>
          opt
            .setName('effect')
            .setDescription('Visual effect style (Default: Two-Tone Gradient)')
            .setRequired(false)
            .addChoices(
              { name: '🌈 Gradient (Effect 2) [Default]', value: 2 },
              { name: '⚡ Neon Glow (Effect 3)', value: 3 },
              { name: '💥 Pop Accent (Effect 5)', value: 5 },
              { name: '🎨 Toon Outline (Effect 4)', value: 4 },
              { name: '⬛ Solid Color (Effect 1)', value: 1 }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Display Color Theme (Default: Orange, White & Green Gradient)')
            .setRequired(false)
            .addChoices(
              { name: '🇮🇳 Tricolor (Orange, White & Green Gradient) [Default]', value: 'tiranga' },
              { name: '💠 UOI Cyan (#38BDF8)', value: 'cyan' },
              { name: '🇮🇳 Saffron Gold (#F59E0B)', value: 'saffron' },
              { name: '🌿 Emerald Green (#10B981)', value: 'emerald' },
              { name: '🔮 Royal Purple (#8B5CF6)', value: 'purple' },
              { name: '🩸 Crimson Red (#EF4444)', value: 'crimson' }
            )
        )
        .addBooleanOption((opt) =>
          opt
            .setName('reset')
            .setDescription('Reset bot display name to normal default appearance')
            .setRequired(false)
        )
    )
    // 10. /card memory (Inspect permanent memory & server setups)
    .addSubcommand((sub) =>
      sub
        .setName('memory')
        .setDescription('Inspect permanent server memory, saved channel setups, and persistent storage health')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const issuingOfficer = {
      discordId: interaction.user.id,
      discordTag: interaction.user.tag,
    };

    // ==========================================
    // COMMAND: /card setup (Required initial setup)
    // ==========================================
    if (sub === 'setup') {
      await interaction.deferReply({ ephemeral: false });

      // Check permission: ManageGuild or Administrator
      if (
        interaction.member &&
        !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only server administrators or members with `Manage Server` can configure the UOI Card System.',
        });
      }

      const staffChannel = interaction.options.getChannel('staff_channel');
      const deliveryChannel = interaction.options.getChannel('delivery_channel');
      const staffRole = interaction.options.getRole('staff_role');
      const autoNickname = interaction.options.getBoolean('auto_nickname') ?? true;

      const db = loadDatabase();
      db.guilds = db.guilds || {};
      db.guilds[guildId] = {
        isSetup: true,
        autoConfigured: false,
        staffChannelId: staffChannel.id,
        staffChannelName: staffChannel.name,
        deliveryChannelId: deliveryChannel ? deliveryChannel.id : null,
        deliveryChannelName: deliveryChannel ? deliveryChannel.name : null,
        staffRoleId: staffRole ? staffRole.id : null,
        staffRoleName: staffRole ? staffRole.name : null,
        autoNickname,
        setupAt: new Date().toISOString(),
        setupBy: {
          discordId: interaction.user.id,
          discordTag: interaction.user.tag,
        },
      };
      saveDatabase(db);
      if (interaction.guild) {
        recordServer(interaction.guild, db.guilds[guildId]);
      }

      const embed = new EmbedBuilder()
        .setTitle('⚙️ UOI ID Card System Setup Complete!')
        .setColor(0x10b981)
        .setDescription(
          `**The Union of Indians ID Card System is now fully configured and ACTIVE on ${interaction.guild?.name || 'this server'}!**\n\n` +
          `All citizen card commands are now **unlocked** and saved to permanent memory.`
        )
        .addFields(
          {
            name: '📥 Staff Review Channel',
            value: `<#${staffChannel.id}> (\`${staffChannel.name}\`)\n*Incoming \`/card generate\` requests will be posted here with interactive Accept & Decline controls.*`,
            inline: false,
          },
          {
            name: '📬 Card Delivery Channel',
            value: deliveryChannel ? `<#${deliveryChannel.id}> (\`${deliveryChannel.name}\`)` : '*(Default: Posts in applicant\'s current channel)*',
            inline: true,
          },
          {
            name: '🛡️ Authorized Reviewers',
            value: staffRole ? `<@&${staffRole.id}>` : '*Server Administrators & Officers*',
            inline: true,
          },
          {
            name: '🏷️ Auto-Nicknaming',
            value: autoNickname ? '✅ Enabled (`Name [Serial]`)' : '❌ Disabled',
            inline: true,
          },
          {
            name: '🧠 Permanent Memory Sync',
            value: '✅ **Saved to permanent memory.** This server\'s configuration, review channels, and permissions will persist across bot reboots, redeployments, and server re-invites.',
            inline: false,
          },
          {
            name: '📋 What happens next?',
            value:
              `1. Citizens can run \`/card generate\` to apply for their card.\n` +
              `2. Applications go directly to <#${staffChannel.id}> for staff review.\n` +
              `3. Staff can click **[✅ Accept & Issue Card]** or **[❌ Decline with Reason]**.\n` +
              `4. You can customize the official card background anytime using \`/card set-template\`!`,
          }
        )
        .setFooter({ text: 'Union of Indians Official Bot Registry • Permanent Memory Active' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // SERVER SETUP GUARD: Check or Auto-Provision from Permanent Memory
    // ==========================================
    const db = loadDatabase();
    let guildConfig = db.guilds?.[guildId];

    // If server setup not found, attempt auto-provisioning from permanent memory or auto-discovery to save setup time!
    if (!guildConfig || !guildConfig.isSetup || !guildConfig.staffChannelId) {
      if (interaction.guild) {
        const autoSetup = autoDetectAndSaveSetup(interaction.guild, interaction.channel);
        if (autoSetup && autoSetup.staffChannelId) {
          db.guilds[guildId] = {
            ...autoSetup,
            name: interaction.guild.name,
            guildId,
          };
          saveDatabase(db);
          guildConfig = db.guilds[guildId];
        }
      }
    }

    if (!guildConfig || !guildConfig.isSetup || !guildConfig.staffChannelId) {
      const embed = new EmbedBuilder()
        .setTitle('🔒 UOI Identification System: Server Setup Required')
        .setColor(0xef4444)
        .setDescription(
          `**This server has not completed UOI Bot setup yet!**\n\n` +
          `All citizen card generation, inspection, verification, and registry commands remain **locked and inactive** until an Administrator configures the server routing.`
        )
        .addFields(
          {
            name: '🛠️ How to Unlock Commands?',
            value: 'A server Administrator must run `/card setup` and specify the **staff_channel** where citizen card applications and approval requests will be delivered.',
          },
          {
            name: '👑 Required Permissions',
            value: '`Administrator` or `Manage Server`',
          }
        )
        .setFooter({ text: 'Union of Indians Registry • Configuration Lock' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ==========================================
    // COMMAND: /card set-template (1 template per server)
    // ==========================================
    if (sub === 'set-template') {
      await interaction.deferReply({ ephemeral: false });

      // Check permission: ManageGuild or Administrator
      if (interaction.member && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only server administrators or members with `Manage Server` can set this server\'s official card template.',
        });
      }

      const attachment = interaction.options.getAttachment('image');
      const urlInput = interaction.options.getString('url');
      const downloadUrl = attachment ? attachment.url : urlInput ? urlInput.trim() : null;

      if (!downloadUrl) {
        return interaction.editReply({
          content: '❌ **Please attach an image** or provide a direct image `url` when running `/card set-template`.',
        });
      }

      try {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) {
          return interaction.editReply({
            content: `❌ Could not download image from the provided source (HTTP ${resp.status}).`,
          });
        }

        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Resilient dimension extraction (Pure JS parser for PNG/JPEG/GIF/WebP, native-free)
        const dims = getImageDimensions(buffer);
        let testImgWidth = dims.width || 1200;
        let testImgHeight = dims.height || 900;

        // Optionally refine with safeLoadImage if canvas is present
        const testImg = await safeLoadImage(buffer);
        if (testImg && testImg.width) {
          testImgWidth = testImg.width;
          testImgHeight = testImg.height;
        }

        ensureDirectories();

        // Enforce 1 template per server: remove any old extension and save template_<guildId>.png
        if (guildId) {
          for (const ext of ['png', 'jpg', 'jpeg']) {
            const oldPath = path.join(TEMPLATES_DIR, `${guildId}.${ext}`);
            if (fs.existsSync(oldPath)) {
              try { fs.unlinkSync(oldPath); } catch (_) {}
            }
          }
          fs.writeFileSync(path.join(TEMPLATES_DIR, `${guildId}.png`), buffer);
        }

        // Also save to root template.png as fallback
        fs.writeFileSync('template.png', buffer);
        try {
          if (!fs.existsSync('public')) fs.mkdirSync('public');
          fs.writeFileSync('public/template.png', buffer);
        } catch (_) {}

        const embed = new EmbedBuilder()
          .setTitle('✅ Official Server Template Saved')
          .setColor(0x10b981)
          .setDescription(
            `Successfully set the **official template** for **${interaction.guild ? interaction.guild.name : 'this server'}** (\`${testImgWidth}×${testImgHeight}px\`).\n` +
            `🔒 **Policy Enforced:** Exactly **1 template per server**. Any previous server template has been superseded.\n` +
            `All future cards generated or viewed with \`/card show\` in this server will stamp directly onto this official template!`
          )
          .addFields(
            { name: 'Server ID', value: `\`${guildId || 'Global'}\``, inline: true },
            { name: 'Storage Slot', value: guildId ? `templates/${guildId}.png` : 'template.png', inline: true },
            { name: 'Resolution', value: `${testImgWidth} × ${testImgHeight} px`, inline: true }
          )
          .setFooter({ text: 'Union of Indians Registry • Single-Template Server Isolation' })
          .setTimestamp();

        const file = new AttachmentBuilder(buffer, { name: 'server-template.png' });
        embed.setImage('attachment://server-template.png');

        return interaction.editReply({ embeds: [embed], files: [file] });
      } catch (err) {
        console.error('[UOI Bot] Error setting template:', err);
        return interaction.editReply({
          content: `❌ **Failed to process template image:** ${err.message}`,
        });
      }
    }

    // ==========================================
    // COMMAND: /card view-template
    // ==========================================
    if (sub === 'view-template') {
      await interaction.deferReply({ ephemeral: true });

      const { img, source, filePath } = await resolveTemplateImage(guildId);
      if (!img && !filePath) {
        return interaction.editReply({
          content:
            '⚠️ **No permanent template found for this server!**\nUse `/card set-template` with your template image attached to upload one (1 template per server).',
        });
      }

      let fileBuffer = null;
      if (filePath && fs.existsSync(filePath)) {
        try { fileBuffer = fs.readFileSync(filePath); } catch (_) {}
      }
      if (!fileBuffer && guildId && fs.existsSync(path.join(TEMPLATES_DIR, `${guildId}.png`))) {
        try { fileBuffer = fs.readFileSync(path.join(TEMPLATES_DIR, `${guildId}.png`)); } catch (_) {}
      }
      if (!fileBuffer) {
        for (const f of ['template.png', 'template.jpg', 'public/template.png']) {
          if (fs.existsSync(f)) {
            try { fileBuffer = fs.readFileSync(f); break; } catch (_) {}
          }
        }
      }

      const dims = fileBuffer ? getImageDimensions(fileBuffer) : { width: img?.width || 1200, height: img?.height || 900 };
      const displayW = img?.width || dims.width;
      const displayH = img?.height || dims.height;

      if (!fileBuffer) {
        return interaction.editReply({
          content: `Active template loaded from: \`${source || 'Configured Template'}\` (${displayW}×${displayH}px)`,
        });
      }

      const file = new AttachmentBuilder(fileBuffer, { name: 'active-template.png' });
      const embed = new EmbedBuilder()
        .setTitle('🖼️ Active Server Card Template')
        .setColor(0x3b82f6)
        .setDescription(`Loaded template for **${interaction.guild ? interaction.guild.name : 'this server'}**:\n• Source: \`${source || filePath || 'Server Storage'}\`\n• Resolution: **${displayW}×${displayH}px**`)
        .setImage('attachment://active-template.png');

      return interaction.editReply({ embeds: [embed], files: [file] });
    }

    // ==========================================
    // COMMAND: /card show (Pull card from database)
    // ==========================================
    if (sub === 'show') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen') || interaction.user;

      const db = loadDatabase();
      const card = db.cards[targetUser.id];

      if (!card || card.status === 'REVOKED') {
        const embed = new EmbedBuilder()
          .setTitle('🔍 UOI Central Registry Search')
          .setColor(0xEF4444)
          .setDescription(`No active UOI Citizen ID card found in the database for <@${targetUser.id}>.`)
          .addFields(
            { name: 'Target Citizen', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
            { name: 'Registry Status', value: card?.status === 'REVOKED' ? '🔴 REVOKED' : '⚪ Unregistered', inline: true },
            { name: 'Issuance Protocol', value: 'An authorized officer can issue a card using `/card generate`.' }
          )
          .setFooter({ text: 'Union of Indians Central Registry Database' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Render the citizen's card on demand using the server's official template
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

      const fileName = `${card.serialId}.png`;
      const files = [];

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ UOI Citizen ID Card: ${card.fullName}`)
        .setColor(0x10b981)
        .setDescription(`Official identity credential retrieved from database for <@${card.discordId}>`)
        .addFields(
          { name: 'Card Serial ID', value: `\`${card.serialId}\``, inline: true },
          { name: 'Citizen', value: `<@${card.discordId}>`, inline: true },
          {
            name: 'Roblox Identity',
            value: card.robloxUserId
              ? `[@${card.robloxUsername}](https://www.roblox.com/users/${card.robloxUserId}/profile)`
              : `@${card.robloxUsername || 'Unlinked'}`,
            inline: true,
          },
          { name: 'Rank Tier', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Gender', value: card.gender || 'N/A', inline: true },
          { name: 'Issuing Officer', value: `<@${card.issuedBy?.discordId || card.issuedBy}>`, inline: true },
          {
            name: 'Issued Date',
            value: `<t:${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:f>`,
            inline: true,
          },
          { name: 'Registry Status', value: '🟢 ACTIVE & VERIFIED', inline: true }
        )
        .setFooter({
          text: usedTemplate
            ? `Central Database Record • Stamped with ${templateSource}`
            : 'Central Database Record • Union of Indians',
        })
        .setTimestamp();

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(`attachment://${fileName}`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // ==========================================
    // COMMAND 1: /card generate (Routes to staff review)
    // ==========================================
    if (sub === 'generate') {
      await interaction.deferReply({ ephemeral: false });

      const targetUser = interaction.options.getUser('citizen') || interaction.user;
      const robloxQuery = interaction.options.getString('roblox');
      const fullName = interaction.options.getString('fullname');
      const gender = interaction.options.getString('gender');
      const assignedRank = (interaction.options.getString('rank') || 'COMMUNITY MEMBER').toUpperCase();

      // STRICT RULE 1: Only 1 card per person!
      const db = loadDatabase();
      const existingCard = db.cards[targetUser.id];
      if (existingCard && existingCard.status === 'ACTIVE') {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ Card Generation Blocked: 1 Card Per Person')
          .setColor(0xf59e0b)
          .setDescription(
            `**<@${targetUser.id}> already possesses an active UOI Citizen Card!**\n` +
            `Under Union regulations, each citizen is restricted to exactly **one card**.`
          )
          .addFields(
            { name: 'Existing Serial ID', value: `\`${existingCard.serialId}\``, inline: true },
            { name: 'Full Name', value: existingCard.fullName, inline: true },
            { name: 'Current Rank', value: `**${existingCard.assignedRank}**`, inline: true },
            { name: 'Roblox Username', value: `@${existingCard.robloxUsername || 'Unlinked'}`, inline: true },
            { name: 'Status', value: '🟢 ACTIVE CITIZEN', inline: true },
            {
              name: 'Issued On',
              value: `<t:${Math.floor(new Date(existingCard.issuedAt).getTime() / 1000)}:R>`,
              inline: true,
            }
          )
          .addFields({
            name: '📋 What to do?',
            value:
              `• Run \`/card show citizen:@${targetUser.username}\` to display their existing registered card.\n` +
              `• To update their rank tier, use \`/card promote\` instead.\n` +
              `• If the previous card was lost or compromised, an authorized officer must run \`/card revoke serial:${existingCard.serialId}\` before re-issuing.`,
          })
          .setFooter({ text: 'Union of Indians Registry • Strict Single-Card Enforcement' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Check if citizen already has a pending request awaiting review
      const existingPending = Object.values(db.pendingRequests || {}).find(
        (r) => r.status === 'PENDING' && r.targetUser?.id === targetUser.id
      );
      if (existingPending) {
        const embed = new EmbedBuilder()
          .setTitle('⏳ Card Request Already Pending Review')
          .setColor(0xf59e0b)
          .setDescription(
            `**<@${targetUser.id}> already has an active card request awaiting staff review!**\n` +
            `Please wait for staff to review the current application in <#${guildConfig.staffChannelId}>.`
          )
          .addFields(
            { name: 'Request ID', value: `\`${existingPending.id}\``, inline: true },
            {
              name: 'Submitted At',
              value: `<t:${Math.floor(new Date(existingPending.submittedAt).getTime() / 1000)}:R>`,
              inline: true,
            },
            { name: 'Status', value: '🟡 Awaiting Officer Approval', inline: true }
          )
          .setFooter({ text: 'Union of Indians Staff Review Queue' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Fetch Roblox details & avatar
      const robloxInfo = await fetchRobloxUserData(robloxQuery);

      const requestId = `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Save pending request to database
      db.pendingRequests = db.pendingRequests || {};
      const requestRecord = {
        id: requestId,
        guildId,
        targetUser: {
          id: targetUser.id,
          tag: targetUser.tag,
        },
        applicantUser: {
          id: interaction.user.id,
          tag: interaction.user.tag,
        },
        fullName,
        gender,
        assignedRank,
        robloxUsername: robloxInfo.username,
        robloxUserId: robloxInfo.userId,
        robloxAvatarUrl: robloxInfo.avatarUrl,
        submittedAt: new Date().toISOString(),
        status: 'PENDING',
        declineReason: null,
        reviewedBy: null,
        reviewedAt: null,
        issuedSerialId: null,
        staffChannelId: null,
        staffMessageId: null,
      };
      db.pendingRequests[requestId] = requestRecord;
      saveDatabase(db);

      // Post interactive review card into the Staff Channel
      let postedToStaff = false;
      try {
        const staffChannel = await interaction.guild.channels.fetch(guildConfig.staffChannelId);
        if (staffChannel && staffChannel.isTextBased()) {
          const staffEmbed = new EmbedBuilder()
            .setTitle(`🛡️ New Citizen Card Application: ${fullName}`)
            .setColor(0xf59e0b)
            .setDescription(
              `A citizen identification card application has been submitted and is awaiting staff approval.\n\n` +
              `• **Citizen:** <@${targetUser.id}> (\`${targetUser.tag}\`)\n` +
              `• **Submitted By:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)`
            )
            .addFields(
              { name: 'Full Citizen Name', value: fullName, inline: true },
              { name: 'Gender', value: gender, inline: true },
              { name: 'Requested Rank', value: `**${assignedRank}**`, inline: true },
              {
                name: 'Roblox Identity',
                value: robloxInfo.userId
                  ? `[@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile) (\`ID: ${robloxInfo.userId}\`)`
                  : `@${robloxInfo.username}`,
                inline: true,
              },
              { name: 'Request ID', value: `\`${requestId}\``, inline: true },
              { name: 'Submitted At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: `UOI Staff Review Queue • Request ${requestId}` })
            .setTimestamp();

          if (robloxInfo.avatarUrl) {
            staffEmbed.setThumbnail(robloxInfo.avatarUrl);
          }

          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`card_accept_${requestId}`)
              .setLabel('Accept & Issue Card')
              .setStyle(ButtonStyle.Success)
              .setEmoji('✅'),
            new ButtonBuilder()
              .setCustomId(`card_decline_${requestId}`)
              .setLabel('Decline with Reason')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('❌')
          );

          const sentMsg = await staffChannel.send({ embeds: [staffEmbed], components: [actionRow] });
          requestRecord.staffChannelId = staffChannel.id;
          requestRecord.staffMessageId = sentMsg.id;
          saveDatabase(db);
          postedToStaff = true;
        }
      } catch (staffErr) {
        console.error('[UOI Bot] Could not post to staff review channel:', staffErr.message);
      }

      // Inform the user that the request has been routed to staff
      const applicantEmbed = new EmbedBuilder()
        .setTitle('📋 Application Submitted for Staff Review')
        .setColor(0x38bdf8)
        .setDescription(
          `**Your UOI Citizen Card application has been dispatched to Staff!**\n\n` +
          `Under Union procedure, ID cards are not issued instantly. Your application has been routed to the staff review channel for officer verification.`
        )
        .addFields(
          { name: 'Request ID', value: `\`${requestId}\``, inline: true },
          { name: 'Target Citizen', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Full Name', value: fullName, inline: true },
          {
            name: 'Roblox Identity',
            value: robloxInfo.userId
              ? `[@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile)`
              : `@${robloxInfo.username}`,
            inline: true,
          },
          { name: 'Requested Rank', value: `**${assignedRank}**`, inline: true },
          {
            name: 'Staff Review Channel',
            value: `<#${guildConfig.staffChannelId}>`,
            inline: true,
          },
          {
            name: '⏱️ What happens next?',
            value:
              '• Union officers will inspect your Roblox account and information in staff chat.\n' +
              '• When **Accepted**, your official card is rendered, delivered, and your nickname updated.\n' +
              '• If **Declined**, staff will provide a specific reason and you will receive a notification.',
          }
        )
        .setFooter({ text: 'Union of Indians Central Registry • Verification Queue' })
        .setTimestamp();

      if (!postedToStaff) {
        applicantEmbed.addFields({
          name: '⚠️ Notice',
          value: 'Could not directly post to configured staff channel. Staff may review this via `/card requests` or bot dashboard.',
        });
      }

      return interaction.editReply({ embeds: [applicantEmbed] });
    }

    // ==========================================
    // COMMAND: /card verify [serial]
    // ==========================================
    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const db = loadDatabase();
      const userId = db.serToUser?.[serial];
      const card = userId ? db.cards[userId] : null;

      if (!card) {
        const embed = new EmbedBuilder()
          .setTitle(`Citizen Card Verification: ${serial}`)
          .setColor(0xef4444)
          .setDescription(`❌ **UNVERIFIED OR FRAUDULENT SERIAL ID**\nSerial \`${serial}\` was not found in the official UOI database.`)
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }

      const isActive = card.status === 'ACTIVE';
      const embed = new EmbedBuilder()
        .setTitle(`Citizen Card Verification: ${serial}`)
        .setColor(isActive ? 0x10b981 : 0xef4444)
        .setDescription(
          isActive
            ? `✅ **AUTHENTIC UOI CITIZEN CARD**\nStatus: **ACTIVE & VERIFIED**\nRegistered in Central Registry.`
            : `🚨 **REVOKED CITIZEN CARD**\nThis credential was revoked and is no longer valid.`
        )
        .addFields(
          { name: 'Citizen', value: `<@${card.discordId}>`, inline: true },
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Roblox', value: `@${card.robloxUsername || 'Unlinked'}`, inline: true },
          { name: 'Rank Tier', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Issuing Officer', value: `<@${card.issuedBy?.discordId || card.issuedBy}>`, inline: true },
          { name: 'Issued Date', value: `<t:${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:d>`, inline: true }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card inspect @user
    // ==========================================
    if (sub === 'inspect') {
      const targetUser = interaction.options.getUser('user');
      const db = loadDatabase();
      const card = db.cards[targetUser.id];

      const embed = new EmbedBuilder()
        .setTitle(`Citizen Dossier: ${targetUser.tag}`)
        .setColor(card?.status === 'ACTIVE' ? 0x6366f1 : 0x64748b)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Discord ID', value: `\`${targetUser.id}\``, inline: true },
          {
            name: 'Citizen Card Status',
            value: card?.status === 'ACTIVE' ? `🟢 Active (\`${card.serialId}\`)` : card?.status === 'REVOKED' ? '🔴 Revoked' : '⚪ None Registered',
            inline: true,
          }
        );

      if (card) {
        embed.addFields(
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Roblox Username', value: `@${card.robloxUsername || 'Unlinked'}`, inline: true },
          { name: 'Rank Tier', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Issued At', value: `<t:${Math.floor(new Date(card.issuedAt).getTime() / 1000)}:f>`, inline: true }
        );
      }

      embed.setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card promote
    // ==========================================
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
        .setColor(0x3b82f6)
        .addFields(
          { name: 'Citizen', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Promoted To', value: `**${newRank}**`, inline: true },
          { name: 'Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Justification', value: reason }
        )
        .setFooter({ text: card ? 'Database record updated successfully' : 'Notice: No database card on file' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card revoke
    // ==========================================
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
        .setColor(0xef4444)
        .setDescription('⚠️ **THIS CITIZEN CARD HAS BEEN REVOKED & BLACKLISTED**')
        .addFields(
          { name: 'Serial ID', value: `\`${serial}\``, inline: true },
          { name: 'Revoking Officer', value: `<@${issuingOfficer.discordId}>`, inline: true },
          { name: 'Reason', value: reason },
          { name: 'Re-issuance Status', value: 'Citizen is now cleared to receive a newly authorized card if appropriate.' }
        )
        .setFooter({ text: 'Database entry marked as REVOKED' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card botstyle (Custom Bot Name Styles with Font 10 Sinistre)
    // ==========================================
    if (sub === 'botstyle') {
      await interaction.deferReply({ ephemeral: false });

      if (
        interaction.member &&
        !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only administrators or members with `Manage Server` can customize the bot display name style.',
        });
      }

      const reset = interaction.options.getBoolean('reset');
      const fontId = interaction.options.getInteger('font') ?? 10; // Default: Font 10 Sinistre
      const effectId = interaction.options.getInteger('effect') ?? 2; // Default: Gradient (Effect 2)
      const colorChoice = interaction.options.getString('color') ?? 'tiranga'; // Default: Tiranga Gradient

      // Orange (Saffron: 0xFF9933), White (0xFFFFFF), Green (India Green: 0x138808)
      let colors = [0xff9933, 0xffffff, 0x138808]; // Default Tiranga Orange, White & Green
      let fallbackColors = [0xff9933, 0x138808];

      if (colorChoice === 'cyan') {
        colors = [0x38bdf8];
        fallbackColors = [0x38bdf8];
      } else if (colorChoice === 'saffron') {
        colors = [0xf59e0b];
        fallbackColors = [0xf59e0b];
      } else if (colorChoice === 'emerald') {
        colors = [0x10b981];
        fallbackColors = [0x10b981];
      } else if (colorChoice === 'purple') {
        colors = [0x8b5cf6];
        fallbackColors = [0x8b5cf6];
      } else if (colorChoice === 'crimson') {
        colors = [0xef4444];
        fallbackColors = [0xef4444];
      } else if (colorChoice === 'tiranga') {
        colors = [0xff9933, 0xffffff, 0x138808]; // Orange, White, Green
        fallbackColors = [0xff9933, 0x138808];    // Resilient fallback if API limits to 2
      }

      const token = (process.env.DISCORD_TOKEN || '').trim();
      if (!token) {
        return interaction.editReply({
          content: '❌ **Bot Token Missing:** DISCORD_TOKEN is not configured.',
        });
      }

      const rest = new REST({ version: '10' }).setToken(token);

      try {
        if (reset) {
          await rest.patch(`/guilds/${guildId}/members/@me`, {
            body: {
              display_name_font_id: null,
              display_name_effect_id: null,
              display_name_colors: null,
            },
          });

          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle('🔄 Bot Display Name Style Reset')
                .setColor(0x94a3b8)
                .setDescription('The bot display name has been reverted to normal standard Discord styling.')
                .setTimestamp(),
            ],
          });
        }

        // Resilient patch: Try 3 colors (Orange, White, Green), fallback to 2 if Discord rejects length
        try {
          await rest.patch(`/guilds/${guildId}/members/@me`, {
            body: {
              display_name_font_id: fontId,
              display_name_effect_id: effectId,
              display_name_colors: colors,
            },
          });
        } catch (firstAttemptErr) {
          if (colors.length > 2) {
            await rest.patch(`/guilds/${guildId}/members/@me`, {
              body: {
                display_name_font_id: fontId,
                display_name_effect_id: effectId,
                display_name_colors: fallbackColors,
              },
            });
          } else {
            throw firstAttemptErr;
          }
        }

        const fontNames = {
          10: 'Font 10: Sinistre (Vampyre / Gothic) 🧛',
          8: 'Font 8: Pixelify Sans (8-Bit Arcade) 👾',
          3: 'Font 3: Cherry Bomb (Sakura) 🌸',
          4: 'Font 4: Chicle (Jellybean) 🍬',
          6: 'Font 6: MuseoModerno (Modern) 🌐',
          7: 'Font 7: Neo-Castel (Medieval) ⚔️',
          11: 'Font 11: GG Sans (Default) 🔄',
          12: 'Font 12: Zilla Slab (Tempo / Serif) 📜',
        };

        const effectNames = {
          1: 'Solid Flat Color',
          2: 'Two-Tone Gradient',
          3: 'Electric Neon Glow ⚡',
          4: 'Toon Pop Outline',
          5: 'Pop Accent Shadow 💥',
        };

        const embed = new EmbedBuilder()
          .setTitle('🎨 UOI Bot Name Style Applied!')
          .setColor(colors[0])
          .setDescription(`Successfully applied **${fontNames[fontId] || `Font ${fontId}`}** to <@${interaction.client.user.id}> in **${interaction.guild?.name || 'this server'}**!`)
          .addFields(
            { name: 'Active Font', value: `\`${fontNames[fontId] || fontId}\``, inline: true },
            { name: 'Visual Effect', value: `\`${effectNames[effectId] || effectId}\``, inline: true },
            { name: 'Color Theme', value: `\`${colorChoice.toUpperCase()}\``, inline: true }
          )
          .setFooter({ text: 'Visible in member list, chat messages, and member profile' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('[UOI Bot] Error applying bot style:', err);
        return interaction.editReply({
          content: `❌ **Failed to apply name style:** ${err.message || 'Discord REST API error'}`,
        });
      }
    }

    // ==========================================
    // COMMAND: /card memory (Inspect permanent memory & server setups)
    // ==========================================
    if (sub === 'memory') {
      await interaction.deferReply({ ephemeral: false });

      const allServers = getAllServerRecords();
      const currentServerRecord = getServerRecord(guildId) || (interaction.guild ? recordServer(interaction.guild) : null);
      const db = loadDatabase();
      const guildSetup = db.guilds?.[guildId] || currentServerRecord?.setup;

      const configuredCount = allServers.filter((s) => s.setup?.isSetup).length;
      const autoCount = allServers.filter((s) => s.setup?.autoConfigured).length;
      const totalCards = Object.keys(db.cards || {}).length;

      const isSetup = guildSetup && guildSetup.isSetup;
      const staffChannelText = guildSetup?.staffChannelId ? `<#${guildSetup.staffChannelId}> (\`${guildSetup.staffChannelName || 'channel'}\`)` : '*Not Set*';
      const deliveryChannelText = guildSetup?.deliveryChannelId ? `<#${guildSetup.deliveryChannelId}> (\`${guildSetup.deliveryChannelName || 'channel'}\`)` : '*Default (Applicant Channel)*';
      const staffRoleText = guildSetup?.staffRoleId ? `<@&${guildSetup.staffRoleId}> (\`${guildSetup.staffRoleName || 'role'}\`)` : '*Administrators & Officers*';
      const autoNickText = guildSetup?.autoNickname ? '✅ Enabled' : '❌ Disabled';
      const setupMode = guildSetup?.autoConfigured ? '⚡ Instant Zero-Config (Auto-Discovered)' : (isSetup ? '🛠️ Manual Administrator Setup' : '⚠️ Pending Setup');

      const embed = new EmbedBuilder()
        .setTitle('🧠 UOI Bot Permanent Memory Registry')
        .setColor(0x0284c7)
        .setDescription(
          `**Permanent Server Memory is ACTIVE and persistent.**\n` +
          `The bot automatically remembers every server it joins, preserving channel routing, roles, citizen cards, and configuration forever across container restarts, Cloud Run deployments, and server re-invites.`
        )
        .addFields(
          {
            name: `📍 Current Server: ${interaction.guild?.name || guildId}`,
            value:
              `• **Setup Status:** ${isSetup ? '✅ Active & Configured' : '⚠️ Not Configured'}\n` +
              `• **Configuration Mode:** ${setupMode}\n` +
              `• **Staff Review Channel:** ${staffChannelText}\n` +
              `• **Card Delivery Channel:** ${deliveryChannelText}\n` +
              `• **Staff Reviewers:** ${staffRoleText}\n` +
              `• **Auto-Nickname:** ${autoNickText}\n` +
              `• **First Remembered:** ${currentServerRecord?.firstSeen ? new Date(currentServerRecord.firstSeen).toLocaleDateString() : 'Today'}`,
            inline: false,
          },
          {
            name: '🌐 Network-Wide Memory Stats',
            value:
              `• **Remembered Servers:** \`${allServers.length}\` total servers\n` +
              `• **Active Setups Saved:** \`${configuredCount}\` servers\n` +
              `• **Zero-Config Instant Setups:** \`${autoCount}\` servers\n` +
              `• **Total Cards in Database:** \`${totalCards}\` citizen cards`,
            inline: true,
          },
          {
            name: '🛡️ Storage & Resilience',
            value:
              `• **Primary Store:** \`data/server_memory.json\`\n` +
              `• **Redundant Backup:** \`data/server_memory.backup.json\`\n` +
              `• **Crash Protection:** Atomic write swapping\n` +
              `• **Time Saved:** Zero-config auto-detection ready!`,
            inline: true,
          }
        )
        .setFooter({ text: 'Union of Indians Official Bot Registry • Permanent Memory' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },

  // ==========================================
  // INTERACTION HANDLERS: Staff Review Buttons
  // ==========================================
  async handleButton(interaction) {
    const customId = interaction.customId;
    const guildId = interaction.guildId;
    const db = loadDatabase();
    const guildConfig = db.guilds?.[guildId];

    // Staff permission check
    if (guildConfig?.staffRoleId) {
      const hasStaffRole = interaction.member?.roles?.cache?.has(guildConfig.staffRoleId);
      const isAdmin =
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!hasStaffRole && !isAdmin) {
        return interaction.reply({
          content: `❌ **Permission Denied:** You need the <@&${guildConfig.staffRoleId}> role to review citizen card applications.`,
          ephemeral: true,
        });
      }
    } else {
      const isAdmin =
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!isAdmin) {
        return interaction.reply({
          content: '❌ **Permission Denied:** Only administrators or members with `Manage Server` can review citizen card applications.',
          ephemeral: true,
        });
      }
    }

    // 1. ACCEPT & ISSUE CARD
    if (customId.startsWith('card_accept_')) {
      const requestId = customId.replace('card_accept_', '');
      const req = db.pendingRequests?.[requestId];

      if (!req) {
        return interaction.reply({
          content: `❌ Card application record \`${requestId}\` not found in the database.`,
          ephemeral: true,
        });
      }

      if (req.status !== 'PENDING') {
        return interaction.reply({
          content: `⚠️ This card application has already been marked as **${req.status}** by <@${req.reviewedBy?.discordId || 'Staff'}>.`,
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      // Generate Serial ID & Server Nickname
      const serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const serverNickname = `${req.fullName} [${serialId}]`;

      // Render Card Image with server's active template
      let cardBuffer = null;
      let usedTemplate = false;
      let templateSource = null;
      try {
        const renderResult = await renderCardImage({
          guildId,
          fullName: req.fullName,
          robloxUsername: req.robloxUsername,
          robloxUserId: req.robloxUserId,
          gender: req.gender,
          assignedRank: req.assignedRank,
          serialId,
          avatarUrl: req.robloxAvatarUrl,
        });
        cardBuffer = renderResult.buffer;
        usedTemplate = renderResult.usedTemplate;
        templateSource = renderResult.source;
      } catch (err) {
        console.error('[UOI Bot] Error rendering approved card image:', err);
      }

      // Save to active card database
      const newCardRecord = {
        discordId: req.targetUser.id,
        discordTag: req.targetUser.tag,
        guildId: guildId || null,
        serialId,
        fullName: req.fullName,
        robloxUsername: req.robloxUsername,
        robloxUserId: req.robloxUserId,
        gender: req.gender,
        assignedRank: req.assignedRank,
        avatarUrl: req.robloxAvatarUrl,
        issuedBy: {
          discordId: interaction.user.id,
          discordTag: interaction.user.tag,
        },
        issuedAt: new Date().toISOString(),
        serverNickname,
        status: 'ACTIVE',
      };
      db.cards[req.targetUser.id] = newCardRecord;
      db.serToUser = db.serToUser || {};
      db.serToUser[serialId] = req.targetUser.id;

      // Update pending request status
      req.status = 'APPROVED';
      req.reviewedBy = { discordId: interaction.user.id, discordTag: interaction.user.tag };
      req.reviewedAt = new Date().toISOString();
      req.issuedSerialId = serialId;
      saveDatabase(db);

      // Edit staff message to show approved state
      try {
        const staffMsgEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0x10b981)
          .setTitle(`✅ Citizen Card Approved & Issued: ${req.fullName}`)
          .addFields(
            { name: 'Decision', value: `✅ **APPROVED** by <@${interaction.user.id}>`, inline: true },
            { name: 'Serial ID Issued', value: `\`${serialId}\``, inline: true }
          );

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('card_done_btn')
            .setLabel(`Approved by @${interaction.user.username}`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
            .setEmoji('✅')
        );

        await interaction.message.edit({ embeds: [staffMsgEmbed], components: [disabledRow] });
      } catch (staffEditErr) {
        console.warn('[UOI Bot] Could not edit staff review message:', staffEditErr.message);
      }

      // Automatically update server nickname if enabled
      if (guildConfig?.autoNickname !== false) {
        try {
          const member = await interaction.guild.members.fetch(req.targetUser.id);
          if (member && member.manageable) {
            await member.setNickname(serverNickname);
          }
        } catch (nickErr) {
          console.warn('[UOI Bot] Nickname update failed:', nickErr.message);
        }
      }

      // Deliver card to delivery channel or applicant
      const fileName = `${serialId}.png`;
      const files = [];
      if (cardBuffer) {
        files.push(new AttachmentBuilder(cardBuffer, { name: fileName }));
      }

      const deliveryEmbed = new EmbedBuilder()
        .setTitle(`🛡️ Official UOI Citizen Card Issued: ${req.fullName}`)
        .setColor(usedTemplate ? 0x10b981 : 0xf59e0b)
        .setDescription(
          `🎉 **Congratulations <@${req.targetUser.id}>! Your application has been approved by staff.**\n` +
          `Your official Union of Indians identification credential is registered in the database.`
        )
        .addFields(
          { name: 'Serial ID', value: `\`${serialId}\``, inline: true },
          { name: 'Citizen Name', value: req.fullName, inline: true },
          { name: 'Rank Tier', value: `**${req.assignedRank}**`, inline: true },
          {
            name: 'Roblox Account',
            value: req.robloxUserId
              ? `[@${req.robloxUsername}](https://www.roblox.com/users/${req.robloxUserId}/profile)`
              : `@${req.robloxUsername}`,
            inline: true,
          },
          { name: 'Approving Officer', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Assigned Nickname', value: `\`${serverNickname}\``, inline: true }
        )
        .setFooter({
          text: usedTemplate
            ? `Central Registry Record • Stamped with ${templateSource}`
            : 'Central Registry Record • Union of Indians',
        })
        .setTimestamp();

      if (cardBuffer) {
        deliveryEmbed.setImage(`attachment://${fileName}`);
      }

      // Dispatch to Delivery channel if configured
      try {
        let targetDeliveryChan = null;
        if (guildConfig?.deliveryChannelId) {
          targetDeliveryChan = await interaction.guild.channels.fetch(guildConfig.deliveryChannelId);
        }
        if (targetDeliveryChan && targetDeliveryChan.isTextBased()) {
          await targetDeliveryChan.send({
            content: `📢 Citizen Card Approved for <@${req.targetUser.id}>!`,
            embeds: [deliveryEmbed],
            files,
          });
        }
      } catch (delChanErr) {
        console.warn('[UOI Bot] Delivery channel dispatch error:', delChanErr.message);
      }

      return interaction.editReply({
        content: `✅ **Card Successfully Issued!**\nSerial ID: \`${serialId}\` created for <@${req.targetUser.id}>. Server database and records have been updated.`,
      });
    }

    // 2. DECLINE WITH REASON (Pops up modal)
    if (customId.startsWith('card_decline_')) {
      const requestId = customId.replace('card_decline_', '');
      const req = db.pendingRequests?.[requestId];

      if (!req) {
        return interaction.reply({
          content: `❌ Card application \`${requestId}\` not found in database.`,
          ephemeral: true,
        });
      }

      if (req.status !== 'PENDING') {
        return interaction.reply({
          content: `⚠️ This request has already been marked as **${req.status}** by <@${req.reviewedBy?.discordId || 'Staff'}>.`,
          ephemeral: true,
        });
      }

      // Pop up a modal asking the officer for the decline reason
      const modal = new ModalBuilder()
        .setCustomId(`card_modal_decline_${requestId}`)
        .setTitle('Decline Citizen Card Application');

      const reasonInput = new TextInputBuilder()
        .setCustomId('decline_reason')
        .setLabel('Reason for Rejection')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('State why this application is rejected (e.g. Invalid Roblox account, incorrect rank, troll name)...')
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(500);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }
  },

  // ==========================================
  // MODAL SUBMIT HANDLER: Decline with Reason
  // ==========================================
  async handleModal(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('card_modal_decline_')) return;

    const requestId = customId.replace('card_modal_decline_', '');
    const reason = interaction.fields.getTextInputValue('decline_reason');
    const guildId = interaction.guildId;
    const db = loadDatabase();
    const guildConfig = db.guilds?.[guildId];
    const req = db.pendingRequests?.[requestId];

    if (!req) {
      return interaction.reply({ content: `❌ Request \`${requestId}\` was not found.`, ephemeral: true });
    }

    if (req.status !== 'PENDING') {
      return interaction.reply({ content: `⚠️ Request is already marked as ${req.status}.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    req.status = 'DECLINED';
    req.declineReason = reason;
    req.reviewedBy = { discordId: interaction.user.id, discordTag: interaction.user.tag };
    req.reviewedAt = new Date().toISOString();
    saveDatabase(db);

    // Update the message in the staff channel
    if (req.staffChannelId && req.staffMessageId) {
      try {
        const staffChannel = await interaction.guild.channels.fetch(req.staffChannelId);
        if (staffChannel && staffChannel.isTextBased()) {
          const staffMsg = await staffChannel.messages.fetch(req.staffMessageId);
          if (staffMsg) {
            const updatedStaffEmbed = EmbedBuilder.from(staffMsg.embeds[0])
              .setColor(0xef4444)
              .setTitle(`❌ Citizen Card Application DECLINED: ${req.fullName}`)
              .addFields(
                { name: 'Decision', value: `❌ **DECLINED** by <@${interaction.user.id}>`, inline: true },
                { name: 'Reason for Rejection', value: reason, inline: false }
              );

            const disabledRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('card_declined_btn')
                .setLabel(`Declined by @${interaction.user.username}`)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true)
                .setEmoji('❌')
            );

            await staffMsg.edit({ embeds: [updatedStaffEmbed], components: [disabledRow] });
          }
        }
      } catch (staffEditErr) {
        console.warn('[UOI Bot] Error editing staff decline message:', staffEditErr.message);
      }
    }

    // Send decline notice to delivery channel or notify citizen
    try {
      let targetDeliveryChan = null;
      if (guildConfig?.deliveryChannelId) {
        targetDeliveryChan = await interaction.guild.channels.fetch(guildConfig.deliveryChannelId);
      }
      if (targetDeliveryChan && targetDeliveryChan.isTextBased()) {
        const declineNotificationEmbed = new EmbedBuilder()
          .setTitle('🚨 UOI Citizen Card Application Declined')
          .setColor(0xef4444)
          .setDescription(`Application update for <@${req.targetUser.id}>`)
          .addFields(
            { name: 'Applicant', value: `<@${req.targetUser.id}>`, inline: true },
            { name: 'Request ID', value: `\`${req.id}\``, inline: true },
            { name: 'Reviewing Officer', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Reason for Rejection', value: reason },
            {
              name: 'Next Steps',
              value: 'The citizen may submit a corrected application using `/card generate` once the stated issue is resolved.',
            }
          )
          .setFooter({ text: 'Union of Indians Staff Review System' })
          .setTimestamp();

        await targetDeliveryChan.send({ content: `<@${req.targetUser.id}>`, embeds: [declineNotificationEmbed] });
      }
    } catch (_) {}

    return interaction.editReply({
      content: `❌ **Card Application Declined.**\nRequest \`${requestId}\` marked as DECLINED with reason: "${reason}".`,
    });
  },
};

export default cardCommand;
