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
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

import {
  loadServerMemory,
  saveServerMemory,
  recordServer,
  autoDetectAndSaveSetup,
  getServerRecord,
  getAllServerRecords,
  findBestStaffRole,
} from '../memory.js';
import {
  TEMPLATES_DIR,
  ensureTemplateDirectories,
  fetchImageBytes,
  processAndNormalizeTemplate,
  saveServerTemplate,
  deleteServerTemplate,
  resolveTemplateImage,
  getServerTemplateStatus,
  generateAndSaveDefaultTemplate,
  safeDecodeImage,
} from '../template_manager.js';
import {
  autoDetectRobloxUser,
  fetchRobloxUserData,
  extractRobloxCandidates,
} from '../roblox_detector.js';
import {
  getGitStatus,
  pullLatestCode,
  gracefulRestart,
} from '../git_sync.js';

// High-Performance Native Canvas Engine (@napi-rs/canvas backed by Skia)
let createCanvas = null;
let loadImage = null;
let ImageClass = null;
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
  ImageClass = napi?.Image || napi?.default?.Image || null;

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

// Secondary fallback: CJS require
if (!createCanvas || typeof createCanvas !== 'function' || !loadImage || typeof loadImage !== 'function') {
  try {
    const napiReq = require('@napi-rs/canvas');
    if (!createCanvas && typeof napiReq?.createCanvas === 'function') {
      createCanvas = napiReq.createCanvas;
      canvasEngineName = '@napi-rs/canvas (CJS)';
      canvasFeatures.engine = '@napi-rs/canvas';
      canvasFeatures.skiaAccelerated = true;
    }
    if (!loadImage && typeof napiReq?.loadImage === 'function') loadImage = napiReq.loadImage;
    if (!ImageClass && napiReq?.Image) ImageClass = napiReq.Image;
  } catch (_) {}
}

// Tertiary fallback: node-canvas if available in environment
if (!createCanvas || typeof createCanvas !== 'function' || !loadImage || typeof loadImage !== 'function') {
  try {
    const nodeCanvas = await import('canvas');
    if (!createCanvas && typeof nodeCanvas?.createCanvas === 'function') {
      createCanvas = nodeCanvas.createCanvas;
      canvasEngineName = 'node-canvas (Cairo)';
      canvasFeatures.engine = 'node-canvas';
      canvasFeatures.skiaAccelerated = false;
    }
    if (!loadImage) loadImage = nodeCanvas?.loadImage || nodeCanvas?.default?.loadImage || null;
    if (!ImageClass) ImageClass = nodeCanvas?.Image || nodeCanvas?.default?.Image || null;
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
    available: typeof createCanvas === 'function' && (typeof loadImage === 'function' || typeof ImageClass === 'function'),
    features: canvasFeatures,
  };
}

// Ultra-safe loadImage wrapper that NEVER throws "loadImage is not a function"
async function safeLoadImage(source) {
  if (!source) return null;

  try {
    // 1. Buffer input
    if (Buffer.isBuffer(source)) {
      if (source.length === 0) return null;
      if (typeof loadImage === 'function') {
        try { return await loadImage(source); } catch (_) {}
      }
      if (ImageClass) {
        try {
          const img = new ImageClass();
          img.src = source;
          if (img.width && img.height) return img;
        } catch (_) {}
      }
      return null;
    }

    // 2. HTTP/HTTPS URL input: fetch with timeout to avoid hanging Discord interactions
    if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))) {
      let buf = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(source, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const arrayBuffer = await resp.arrayBuffer();
          buf = Buffer.from(arrayBuffer);
        }
      } catch (_) {}

      if (buf && buf.length > 0) {
        if (typeof loadImage === 'function') {
          try { return await loadImage(buf); } catch (_) {}
        }
        if (ImageClass) {
          try {
            const img = new ImageClass();
            img.src = buf;
            if (img.width && img.height) return img;
          } catch (_) {}
        }
      }

      // Fallback to direct URL if loadImage accepts strings
      if (typeof loadImage === 'function') {
        try { return await loadImage(source); } catch (_) {}
      }
      return null;
    }

    // 3. File path string input
    if (typeof source === 'string') {
      if (!fs.existsSync(source)) return null;
      const stat = fs.statSync(source);
      if (stat.size === 0) return null;

      if (typeof loadImage === 'function') {
        try { return await loadImage(source); } catch (_) {}
      }
      if (ImageClass) {
        try {
          const fileBuf = fs.readFileSync(source);
          const img = new ImageClass();
          img.src = fileBuf;
          if (img.width && img.height) return img;
        } catch (_) {}
      }
      return null;
    }

    if (typeof loadImage === 'function') {
      try { return await loadImage(source); } catch (_) {}
    }
  } catch (err) {
    console.warn('[UOI Bot] Safe image load notice:', err.message);
    return null;
  }
  return null;
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
// PERSISTENT DATABASE & TEMPLATE MANAGEMENT (OPTIMIZED IN-MEMORY CACHE)
// ========================================================
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'cards.json');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

let _cachedCardsDb = null;
let _cardsSaveTimeout = null;
let _cardsIsDirty = false;

export function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  }
  if (!fs.existsSync(BACKUPS_DIR)) {
    try { fs.mkdirSync(BACKUPS_DIR, { recursive: true }); } catch (_) {}
  }
  if (!fs.existsSync(TEMPLATES_DIR)) {
    try { fs.mkdirSync(TEMPLATES_DIR, { recursive: true }); } catch (_) {}
  }
}

export function ensureBackupDirectory() {
  ensureDirectories();
  if (!fs.existsSync(BACKUPS_DIR)) {
    try { fs.mkdirSync(BACKUPS_DIR, { recursive: true }); } catch (_) {}
  }
}

/**
 * Saves an immutable, permanent backup snapshot in data/backups/
 */
export function savePermanentSnapshot(prefix, name, content) {
  ensureBackupDirectory();
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (name || 'data').replace(/[^a-zA-Z0-9._-]/g, '_');
    const snapshotFileName = `${prefix}_${timestamp}_${safeName}`;
    const filePath = path.join(BACKUPS_DIR, snapshotFileName);
    fs.writeFileSync(filePath, content);
    console.log(`[UOI Bot] 💾 Permanent archive snapshot saved: ${snapshotFileName}`);
    return snapshotFileName;
  } catch (err) {
    console.warn('[UOI Bot] Error saving permanent snapshot:', err.message);
    return null;
  }
}

// ========================================================
// VISUAL STYLING REGISTRY: EXPANDED EFFECTS & COLOR THEMES
// ========================================================
export const BOT_STYLE_EFFECTS = {
  1: { id: 1, name: 'Solid Flat Color', emoji: '⬛', description: 'Clean monochromatic solid color tone' },
  2: { id: 2, name: 'Two-Tone Linear Gradient', emoji: '🌈', description: 'Smooth two-color dynamic linear transition [Default]' },
  3: { id: 3, name: 'Electric Neon Glow', emoji: '⚡', description: 'High-intensity neon luminescence & glow' },
  4: { id: 4, name: 'Toon Pop Outline', emoji: '🎨', description: 'Bold comic-style accent contour outline' },
  5: { id: 5, name: '3D Pop Drop-Shadow', emoji: '💥', description: 'Dimensional pop shadow with elevated contrast' },
  6: { id: 6, name: 'Holographic Prismatic Shimmer', emoji: '🔮', description: 'Prismatic diffraction shimmer effect' },
  7: { id: 7, name: 'Cyberpunk Pulse & Glitch', emoji: '⚡', description: 'Futuristic cyberpunk neon pulse and edge aura' },
  8: { id: 8, name: 'Velvet Luxe Radiance', emoji: '✨', description: 'Warm luxury ambient glow and rich saturation' },
  9: { id: 9, name: 'Radial Sunburst Flare', emoji: '☀️', description: 'Vibrant radial flare centered outward' },
};

export const BOT_STYLE_COLORS = {
  tiranga: {
    name: '🇮🇳 Indian Tricolor',
    label: 'Dark Orange & Forest Green',
    colors: [0xd95700, 0x0d652d],
    hex: ['#D95700', '#0D652D'],
    primaryHex: '#D95700',
    description: 'National Tiranga saffron & dark forest green gradient',
  },
  ashoka_navy: {
    name: '🇮🇳 Ashoka Royal Navy',
    label: 'Navy Blue & Saffron',
    colors: [0x000080, 0xff671f],
    hex: ['#000080', '#FF671F'],
    primaryHex: '#000080',
    description: 'Ashoka Chakra deep navy & bright saffron',
  },
  cyber_cyan: {
    name: '⚡ Cyberpunk Neon',
    label: 'Electric Cyan & Neon Blue',
    colors: [0x00f0ff, 0x3b82f6],
    hex: ['#00F0FF', '#3B82F6'],
    primaryHex: '#00F0FF',
    description: 'High-voltage electric cyan & neon blue glow',
  },
  imperial_gold: {
    name: '👑 Imperial Gold',
    label: 'Warm Gold & Rich Amber',
    colors: [0xf59e0b, 0xb45309],
    hex: ['#F59E0B', '#B45309'],
    primaryHex: '#F59E0B',
    description: 'Prestige executive gold & deep amber',
  },
  blood_crimson: {
    name: '🩸 Blood Crimson',
    label: 'Crimson Red & Dark Scarlet',
    colors: [0xef4444, 0x991b1b],
    hex: ['#EF4444', '#991B1B'],
    primaryHex: '#EF4444',
    description: 'High-security warning red & deep scarlet',
  },
  emerald_forest: {
    name: '🌿 Deep Emerald',
    label: 'Forest Green & Jade Mint',
    colors: [0x0d652d, 0x10b981],
    hex: ['#0D652D', '#10B981'],
    primaryHex: '#0D652D',
    description: 'Lush dark forest green & jade mint',
  },
  royal_purple: {
    name: '🔮 Royal Amethyst',
    label: 'Amethyst & Cosmic Violet',
    colors: [0x8b5cf6, 0x6d28d9],
    hex: ['#8B5CF6', '#6D28D9'],
    primaryHex: '#8B5CF6',
    description: 'Royal sovereign violet & deep purple',
  },
  sunset_blaze: {
    name: '🌅 Sunset Blaze',
    label: 'Solar Orange & Coral Flame',
    colors: [0xf97316, 0xf43f5e],
    hex: ['#F97316', '#F43F5E'],
    primaryHex: '#F97316',
    description: 'Radiant tropical sunset orange & coral flame',
  },
  toxic_matrix: {
    name: '☣️ Toxic Acid Matrix',
    label: 'Acid Lime & Terminal Green',
    colors: [0x84cc16, 0x22c55e],
    hex: ['#84CC16', '#22C55E'],
    primaryHex: '#84CC16',
    description: 'Bio-hazard radioactive lime & matrix console green',
  },
  midnight_sapphire: {
    name: '🌌 Midnight Sapphire',
    label: 'Deep Sapphire & Dark Cobalt',
    colors: [0x2563eb, 0x1e1b4b],
    hex: ['#2563EB', '#1E1B4B'],
    primaryHex: '#2563EB',
    description: 'Deep celestial sapphire blue & space cobalt',
  },
  sakura_blossom: {
    name: '🌸 Sakura Blossom',
    label: 'Sakura Pink & Cotton Rose',
    colors: [0xec4899, 0xf472b6],
    hex: ['#EC4899', '#F472B6'],
    primaryHex: '#EC4899',
    description: 'Delicate Japanese cherry blossom pink',
  },
  obsidian_stealth: {
    name: '🖤 Obsidian Stealth',
    label: 'Obsidian Black & Dark Slate',
    colors: [0x334155, 0x0f172a],
    hex: ['#334155', '#0F172A'],
    primaryHex: '#334155',
    description: 'Tactical covert ops matte slate & dark obsidian',
  },
  arctic_glacier: {
    name: '❄️ Arctic Glacier',
    label: 'Glacier Cyan & Frost Silver',
    colors: [0x06b6d4, 0xe2e8f0],
    hex: ['#06B6D4', '#E2E8F0'],
    primaryHex: '#06B6D4',
    description: 'Sub-zero glacial cyan & polar frost',
  },
  plasma_fire: {
    name: '🔥 Plasma Fire',
    label: 'Molten Lava & Sunfire Orange',
    colors: [0xff5722, 0xffc107],
    hex: ['#FF5722', '#FFC107'],
    primaryHex: '#FF5722',
    description: 'Superheated molten plasma & solar flare',
  },
  synthwave_neon: {
    name: '🌆 Synthwave Neon',
    label: 'Hot Magenta & Electric Violet',
    colors: [0xd946ef, 0x8b5cf6],
    hex: ['#D946EF', '#8B5CF6'],
    primaryHex: '#D946EF',
    description: 'Retro 80s outrun magenta & electric violet',
  },
  bronze_copper: {
    name: '🛡️ Antique Bronze',
    label: 'Warm Bronze & Burnished Copper',
    colors: [0xd97706, 0x78350f],
    hex: ['#D97706', '#78350F'],
    primaryHex: '#D97706',
    description: 'Ancient veteran medal bronze & weathered copper',
  },
  aurora_teal: {
    name: '🌌 Aurora Borealis',
    label: 'Northern Teal & Cosmic Indigo',
    colors: [0x14b8a6, 0x6366f1],
    hex: ['#14B8A6', '#6366F1'],
    primaryHex: '#14B8A6',
    description: 'Mystical polar aurora teal & twilight indigo',
  },
  velvet_wine: {
    name: '🍷 Velvet Wine',
    label: 'Velvet Ruby & Deep Maroon',
    colors: [0xe11d48, 0x881337],
    hex: ['#E11D48', '#881337'],
    primaryHex: '#E11D48',
    description: 'Imperial velvet ruby red & rich burgundy',
  },
  uoi_cyan: {
    name: '💠 UOI Signature Cyan',
    label: 'UOI Cyan & Deep Sky',
    colors: [0x38bdf8, 0x0284c7],
    hex: ['#38BDF8', '#0284C7'],
    primaryHex: '#38BDF8',
    description: 'Official Union of Indians government cyan brand',
  },
  solar_yellow: {
    name: '☀️ Solar Flare',
    label: 'Electric Yellow & Saffron Gold',
    colors: [0xeab308, 0xea580c],
    hex: ['#EAB308', '#EA580C'],
    primaryHex: '#EAB308',
    description: 'Luminous radiant solar yellow & deep saffron',
  },
  deep_nebula: {
    name: '🚀 Deep Nebula',
    label: 'Nebula Purple & Starlight Blue',
    colors: [0x6366f1, 0xa855f7],
    hex: ['#6366F1', '#A855F7'],
    primaryHex: '#6366F1',
    description: 'Deep interstellar cosmic nebula glow',
  },
  platinum_ghost: {
    name: '👻 Platinum Ghost',
    label: 'Ghost Platinum & Polished Silver',
    colors: [0xcbd5e1, 0x64748b],
    hex: ['#CBD5E1', '#64748B'],
    primaryHex: '#CBD5E1',
    description: 'Sleek aerospace platinum & polished silver slate',
  },
  ruby_rose: {
    name: '🌹 Ruby Rose',
    label: 'Bright Rose & Vivid Berry',
    colors: [0xfb7185, 0xbe123c],
    hex: ['#FB7185', '#BE123C'],
    primaryHex: '#FB7185',
    description: 'Romantic ruby blossom rose & berry',
  },
  ocean_lagoon: {
    name: '🌊 Ocean Lagoon',
    label: 'Tropical Turquoise & Sea Blue',
    colors: [0x0284c7, 0x2dd4bf],
    hex: ['#0284C7', '#2DD4BF'],
    primaryHex: '#0284C7',
    description: 'Crisp tropical ocean turquoise & seafoam',
  },
  golden_hour: {
    name: '✨ Golden Hour',
    label: 'Sunburst Gold & Sunset Amber',
    colors: [0xf59e0b, 0xf97316],
    hex: ['#F59E0B', '#F97316'],
    primaryHex: '#F59E0B',
    description: 'Warm cinematic sunset golden hour illumination',
  },
};

/**
 * Resolves bot styling colors with support for pre-set themes and custom hex colors
 */
export function resolveBotStyleColors(colorChoice = 'tiranga', customHex1 = null, customHex2 = null) {
  // 1. If user provided custom primary hex
  if (customHex1 && typeof customHex1 === 'string') {
    const cleanHex1 = customHex1.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(cleanHex1)) {
      const num1 = parseInt(cleanHex1, 16);
      let num2 = num1;
      let cleanHex2 = cleanHex1;

      if (customHex2 && typeof customHex2 === 'string') {
        const c2 = customHex2.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(c2)) {
          num2 = parseInt(c2, 16);
          cleanHex2 = c2;
        }
      }

      return {
        themeKey: 'custom',
        themeName: `Custom Palette (#${cleanHex1.toUpperCase()}${cleanHex2 !== cleanHex1 ? ` & #${cleanHex2.toUpperCase()}` : ''})`,
        colors: [num1, num2],
        hex: [`#${cleanHex1.toUpperCase()}`, `#${cleanHex2.toUpperCase()}`],
        primaryHex: `#${cleanHex1.toUpperCase()}`,
        isCustom: true,
        description: 'Bespoke custom hex color palette',
      };
    }
  }

  // 2. Pre-set theme lookup
  const key = String(colorChoice || 'tiranga').toLowerCase().trim();
  const theme = BOT_STYLE_COLORS[key] || BOT_STYLE_COLORS['tiranga'];
  return {
    themeKey: key in BOT_STYLE_COLORS ? key : 'tiranga',
    themeName: theme.name,
    colors: [...theme.colors],
    hex: [...theme.hex],
    primaryHex: theme.primaryHex,
    isCustom: false,
    description: theme.description,
  };
}

/**
 * Card Visual Accent Themes
 */
export const CARD_VISUAL_THEMES = {
  gold: { key: 'gold', name: 'Imperial Gold', primary: '#F59E0B', secondary: '#B45309', border: '#F59E0B' },
  cyan: { key: 'cyan', name: 'UOI Cyan', primary: '#38BDF8', secondary: '#0284C7', border: '#38BDF8' },
  crimson: { key: 'crimson', name: 'Blood Crimson', primary: '#EF4444', secondary: '#991B1B', border: '#EF4444' },
  emerald: { key: 'emerald', name: 'Forest Emerald', primary: '#10B981', secondary: '#0D652D', border: '#10B981' },
  purple: { key: 'purple', name: 'Royal Amethyst', primary: '#8B5CF6', secondary: '#6D28D9', border: '#8B5CF6' },
  cyber: { key: 'cyber', name: 'Cyberpunk Neon', primary: '#00F0FF', secondary: '#3B82F6', border: '#00F0FF' },
  matrix: { key: 'matrix', name: 'Toxic Matrix', primary: '#22C55E', secondary: '#84CC16', border: '#22C55E' },
  sunset: { key: 'sunset', name: 'Sunset Blaze', primary: '#F97316', secondary: '#F43F5E', border: '#F97316' },
  sakura: { key: 'sakura', name: 'Sakura Blossom', primary: '#EC4899', secondary: '#F472B6', border: '#EC4899' },
  stealth: { key: 'stealth', name: 'Obsidian Stealth', primary: '#64748B', secondary: '#0F172A', border: '#64748B' },
};

/**
 * Card Visual Effects
 */
export const CARD_VISUAL_EFFECTS = {
  standard: { key: 'standard', name: 'Clean Standard', description: 'Official clean high-contrast blueprint layout' },
  holographic: { key: 'holographic', name: 'Prismatic Hologram', description: 'Prismatic diffraction foil & security guilloche curves' },
  gold_embossed: { key: 'gold_embossed', name: 'Gold Foil Embossed', description: 'Dual metallic gold borders with beveled corner crests' },
  stealth: { key: 'stealth', name: 'Night-Vision Stealth', description: 'Matte dark tactical border with muted monochrome tones' },
};

/**
 * Resolves card accent colors and effects
 */
export function resolveCardVisualTheme(themeKey = null, effectKey = null) {
  const tKey = String(themeKey || 'gold').toLowerCase().trim();
  const theme = CARD_VISUAL_THEMES[tKey] || CARD_VISUAL_THEMES['gold'];

  const eKey = String(effectKey || 'standard').toLowerCase().trim();
  const effect = CARD_VISUAL_EFFECTS[eKey] || CARD_VISUAL_EFFECTS['standard'];

  return { theme, effect };
}

/**
 * Applies visual bot styling (font, effect, colors) to a Discord guild.
 * Updates Discord member profile through REST and ensures the bot's server role
 * is colored so its username is vibrantly colored in chat, sidebars, and profile popups.
 */
export async function applyBotStyleToGuild(guild, rest, botStyleConfig = null, clientUser = null) {
  if (!guild) return { success: false, error: 'Guild required' };

  const style = botStyleConfig || {
    fontId: 10,
    effectId: 2,
    colors: [0xd95700, 0x0d652d],
  };

  const fontId = style.fontId ?? 10;
  const effectId = style.effectId ?? 2;
  const colors = Array.isArray(style.colors) && style.colors.length > 0 ? style.colors : [0xd95700, 0x0d652d];
  const primaryColor = colors[0];

  let roleUpdated = false;
  let roleName = null;
  let restPatched = false;
  let restError = null;

  // 1. Update bot server role color for guaranteed chat & member list styling
  try {
    const botId = clientUser?.id || globalThis.__uoiBotClient?.user?.id;
    const botMember = guild.members?.me || (botId ? await guild.members.fetch(botId).catch(() => null) : null);
    if (botMember) {
      let roleToColor = botMember.roles?.cache
        ?.filter((r) => r.editable && r.id !== guild.id)
        ?.sort((a, b) => b.position - a.position)
        ?.first();

      // If no editable role exists, attempt creating a cosmetic display role if bot has ManageRoles
      if (!roleToColor && botMember.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        try {
          roleToColor = guild.roles.cache.find((r) => r.name === 'UOI Bot Display' && r.editable);
          if (!roleToColor) {
            roleToColor = await guild.roles.create({
              name: 'UOI Bot Display',
              color: primaryColor,
              reason: 'UOI Bot Display Name Color',
            });
          }
          if (roleToColor && !botMember.roles.cache.has(roleToColor.id)) {
            await botMember.roles.add(roleToColor);
          }
        } catch (_) {}
      }

      if (roleToColor) {
        await roleToColor.setColor(primaryColor);
        roleUpdated = true;
        roleName = roleToColor.name;
      }
    }
  } catch (roleErr) {
    console.warn(`[UOI Bot] Notice setting role color in ${guild.name || guild.id}:`, roleErr.message);
  }

  // 2. Patch Discord member display name styling (Max 2 colors)
  if (rest) {
    try {
      await rest.patch(`/guilds/${guild.id}/members/@me`, {
        body: {
          display_name_font_id: fontId,
          display_name_effect_id: effectId,
          display_name_colors: colors.slice(0, 2),
        },
      });
      restPatched = true;
    } catch (patchErr) {
      restError = patchErr.message;
    }
  }

  return {
    success: roleUpdated || restPatched,
    roleUpdated,
    roleName,
    restPatched,
    restError,
    fontId,
    effectId,
    colors,
  };
}

/**
 * Computes exact 2-month card expiration date from issue date
 */
export function computeCardExpiration(issuedDateInput) {
  const issued = issuedDateInput ? new Date(issuedDateInput) : new Date();
  const base = isNaN(issued.getTime()) ? new Date() : issued;
  const expires = new Date(base.getTime());
  expires.setMonth(expires.getMonth() + 2);
  return expires;
}

/**
 * Formats a date cleanly in UTC for card display and audit logs
 */
export function formatCardDateTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
}

/**
 * Standard Application Expiry Policy:
 * Card applications automatically expire after 48 hours to prevent buggy, stuck, or hanging requests.
 */
export const DEFAULT_APPLICATION_EXPIRY_HOURS = 48;

/**
 * Returns application expiry duration in milliseconds (defaults to 48 hours)
 */
export function getApplicationExpiryMs(guildConfig = null) {
  const hours = (guildConfig && typeof guildConfig.applicationExpiryHours === 'number' && guildConfig.applicationExpiryHours > 0)
    ? guildConfig.applicationExpiryHours
    : DEFAULT_APPLICATION_EXPIRY_HOURS;
  return hours * 60 * 60 * 1000;
}

/**
 * Checks whether a card application has expired past its review window (e.g. 48 hours).
 */
export function isApplicationExpired(req, guildConfig = null) {
  if (!req) return false;
  if (req.status === 'EXPIRED') return true;
  if (req.status !== 'PENDING') return false;

  const now = Date.now();
  if (req.expiresAt) {
    const expMs = new Date(req.expiresAt).getTime();
    if (!isNaN(expMs) && now >= expMs) return true;
  }

  if (req.submittedAt) {
    const subMs = new Date(req.submittedAt).getTime();
    const timeoutMs = getApplicationExpiryMs(guildConfig);
    if (!isNaN(subMs) && (now - subMs >= timeoutMs)) return true;
  }

  return false;
}

/**
 * Background sentinel to sweep and expire pending card applications that have exceeded their review window.
 * Updates review messages to disabled state and informs applicants via DM so they are not blocked.
 */
export async function checkAndExpirePendingApplications(client) {
  if (!client || !client.isReady()) return;
  const db = loadDatabase();
  if (!db.pendingRequests) return;

  const now = Date.now();
  let dbDirty = false;

  for (const [requestId, req] of Object.entries(db.pendingRequests)) {
    if (!req || req.status !== 'PENDING') continue;

    const guildConfig = db.guilds?.[req.guildId];
    if (isApplicationExpired(req, guildConfig)) {
      req.status = 'EXPIRED';
      req.expiredAt = new Date().toISOString();
      dbDirty = true;
      console.log(`[UOI Bot] ⏰ Auto-expired stale card application: ${requestId} (${req.fullName})`);

      // 1. Update review message in staff channel to disabled expired state
      if (req.staffChannelId && req.staffMessageId) {
        try {
          const staffChannel = await client.channels.fetch(req.staffChannelId).catch(() => null);
          if (staffChannel && staffChannel.isTextBased()) {
            const staffMsg = await staffChannel.messages.fetch(req.staffMessageId).catch(() => null);
            if (staffMsg) {
              const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('card_expired_btn')
                  .setLabel('Application Expired (48h Timeout)')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true)
                  .setEmoji('⏰')
              );

              const originalEmbed = staffMsg.embeds[0];
              const updatedStaffEmbed = originalEmbed
                ? EmbedBuilder.from(originalEmbed)
                    .setColor(0x64748b)
                    .setTitle(`⏰ Citizen Card Application EXPIRED: ${req.fullName}`)
                    .setDescription(
                      `⚠️ **APPLICATION EXPIRED**: This application was not reviewed within the 48-hour review window and has expired.\n` +
                      `The buttons have been deactivated, and the citizen has been cleared to submit a fresh application.`
                    )
                : new EmbedBuilder()
                    .setColor(0x64748b)
                    .setTitle(`⏰ Citizen Card Application EXPIRED: ${req.fullName}`);

              await staffMsg.edit({ embeds: [updatedStaffEmbed], components: [disabledRow] }).catch(() => {});
            }
          }
        } catch (_) {}
      }

      // 2. Proactively DM the applicant informing them their application expired so they can re-apply freely
      if (req.targetUser?.id) {
        try {
          const user = await client.users.fetch(req.targetUser.id).catch(() => null);
          if (user) {
            const serverName = (req.guildId && db.guilds?.[req.guildId]?.name) || 'Union of Indians';
            const submittedUnix = Math.floor(new Date(req.submittedAt || now).getTime() / 1000);
            const dmEmbed = new EmbedBuilder()
              .setTitle('⏰ Citizen Card Application Expired')
              .setColor(0xf59e0b)
              .setDescription(
                `Hello **${req.fullName}**, your citizen card application for **${serverName}** has reached its **48-hour review timeout** and has expired.\n\n` +
                `Applications automatically expire to prevent requests from hanging or bugging when staff is busy. Your account is **unlocked and cleared** to submit a fresh application anytime!`
              )
              .addFields(
                { name: 'Request ID', value: `\`${requestId}\``, inline: true },
                { name: '🏛️ Server', value: serverName, inline: true },
                { name: '📅 Submitted At', value: `<t:${submittedUnix}:d> (<t:${submittedUnix}:R>)`, inline: true },
                {
                  name: '👉 How to Reapply',
                  value: `Run \`/card apply\` or \`/card generate\` in **${serverName}** to submit an updated application.`,
                  inline: false,
                }
              )
              .setFooter({ text: 'Union of Indians Registry • Application Expiry Sentinel' })
              .setTimestamp();

            await user.send({ embeds: [dmEmbed] }).catch(() => {});
          }
        } catch (_) {}
      }
    }
  }

  if (dbDirty) {
    saveDatabase(db);
    flushCardsDbSync();
  }
}

/**
 * Bulletproof Interaction Helpers
 * Resilient against DiscordAPIError 10062 (Unknown interaction),
 * 40060 (Interaction has already been acknowledged), and token expirations.
 */
export async function safeDeferReply(interaction, options = {}) {
  try {
    if (!interaction) return false;
    if (interaction.deferred || interaction.replied) return true;
    await interaction.deferReply(options);
    return true;
  } catch (err) {
    if (
      err.code === 10062 ||
      err.code === 40060 ||
      err.message?.includes('Unknown interaction') ||
      err.message?.includes('already been acknowledged')
    ) {
      console.warn(`[UOI Bot] Non-fatal interaction notice during defer: ${err.message}`);
      return false;
    }
    console.warn('[UOI Bot] Warning during safeDeferReply:', err.message);
    return false;
  }
}

export async function safeEditReply(interaction, options) {
  try {
    if (!interaction) return null;
    // Try editReply first (handles deferred or replied interactions)
    try {
      return await interaction.editReply(options);
    } catch (editErr) {
      // If editReply failed because interaction wasn't deferred/replied, use reply
      return await interaction.reply(options).catch(async () => {
        return await interaction.followUp(options).catch(() => null);
      });
    }
  } catch (err) {
    if (
      err.code === 10062 ||
      err.code === 40060 ||
      err.message?.includes('Unknown interaction') ||
      err.message?.includes('already been acknowledged')
    ) {
      console.warn(`[UOI Bot] Non-fatal interaction notice during safeEditReply: ${err.message}`);
      return null;
    }
    console.warn('[UOI Bot] Warning in safeEditReply:', err.message);
    return null;
  }
}

export async function safeReply(interaction, options) {
  try {
    if (!interaction) return null;
    try {
      return await interaction.reply(options);
    } catch (replyErr) {
      return await interaction.editReply(options).catch(async () => {
        return await interaction.followUp(options).catch(() => null);
      });
    }
  } catch (err) {
    if (
      err.code === 10062 ||
      err.code === 40060 ||
      err.message?.includes('Unknown interaction') ||
      err.message?.includes('already been acknowledged')
    ) {
      console.warn(`[UOI Bot] Non-fatal interaction notice during safeReply: ${err.message}`);
      return null;
    }
    console.warn('[UOI Bot] Warning in safeReply:', err.message);
    return null;
  }
}

export async function safeFollowUp(interaction, options) {
  try {
    if (!interaction) return null;
    return await interaction.followUp(options);
  } catch (err) {
    if (
      err.code === 10062 ||
      err.code === 40060 ||
      err.message?.includes('Unknown interaction') ||
      err.message?.includes('already been acknowledged')
    ) {
      console.warn(`[UOI Bot] Non-fatal interaction notice during safeFollowUp: ${err.message}`);
      return null;
    }
    console.warn('[UOI Bot] Warning in safeFollowUp:', err.message);
    return null;
  }
}

/**
 * Stamps date, time, 2-month expiry, and reminder flags on a card record.
 * Handles both marked and unmarked formats.
 */
export function stampCardTimestamps(card, { forceNow = false } = {}) {
  const now = new Date();
  let issuedDate;
  let wasUnmarked = false;

  if (forceNow || !card.issuedAt || isNaN(new Date(card.issuedAt).getTime())) {
    issuedDate = now;
    wasUnmarked = true;
  } else {
    issuedDate = new Date(card.issuedAt);
  }

  const expiresDate = card.expiresAt && !isNaN(new Date(card.expiresAt).getTime())
    ? new Date(card.expiresAt)
    : computeCardExpiration(issuedDate);

  card.issuedAt = issuedDate.toISOString();
  card.issuedAtFormatted = formatCardDateTime(issuedDate);
  card.expiresAt = expiresDate.toISOString();
  card.expiresAtFormatted = formatCardDateTime(expiresDate);
  card.expiresAtTimestamp = Math.floor(expiresDate.getTime() / 1000);

  // Reminders tracker for all four threshold DMs (10, 5, 3, 1 days prior) + expired notice
  card.remindersSent = card.remindersSent || {
    d10: false,
    d5: false,
    d3: false,
    d1: false,
    expired: false,
  };

  // Status check: if expired past 2 months
  if (Date.now() >= expiresDate.getTime() && card.status === 'ACTIVE') {
    card.status = 'EXPIRED';
  } else if (!card.status) {
    card.status = 'ACTIVE';
  }

  return { card, wasUnmarked };
}

/**
 * Resilient card file parser: parses JSON arrays, single objects, wrapped objects,
 * or CSV spreadsheets. Automatically detects and accepts unmarked formats.
 */
export function parseCardFile(buffer, filename = 'cards.json') {
  if (!buffer || buffer.length === 0) {
    return { cards: [], isUnmarkedFormat: false, error: 'Empty file buffer' };
  }

  const rawStr = buffer.toString('utf8').trim();
  const lowerName = filename.toLowerCase();
  const cards = [];
  let isUnmarkedFormat = false;

  if (lowerName.endsWith('.csv') || (!rawStr.startsWith('{') && !rawStr.startsWith('['))) {
    // Parse CSV
    const lines = rawStr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return { cards: [], isUnmarkedFormat: false, error: 'CSV file must have a header row and at least one data row' };
    }

    function parseCsvLine(line) {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          if (inQuotes && line[i + 1] === char) {
            cur += char;
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur.trim());
      return result;
    }

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const hasDateField = headers.some((h) => h.includes('issued') || h.includes('date') || h.includes('created') || h.includes('expires'));
    if (!hasDateField) {
      isUnmarkedFormat = true;
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] !== undefined ? cols[idx] : '';
      });

      const serialId = row.serialid || row.serial || row.id || row.cardid || null;
      const fullName = row.fullname || row.name || row.citizenname || row.citizen || 'Unknown Citizen';
      const gender = row.gender || row.sex || 'Unspecified';
      const robloxUsername = row.robloxusername || row.roblox || row.robloxuser || '';
      const robloxUserId = row.robloxuid || row.robloxid || row.uid || '';
      const assignedRank = row.rank || row.assignedrank || row.role || 'CITIZEN';
      const division = row.division || row.dept || row.department || 'Civilian Directorate';
      const clearanceLevel = row.clearancelevel || row.clearance || computeClearanceLevel(assignedRank, division);
      const status = (row.status || 'ACTIVE').toUpperCase();
      const discordId = row.discordid || row.userid || row.discorduid || '';
      const discordTag = row.discordtag || row.tag || fullName;
      const rawIssuedAt = row.issuedat || row.issueddate || row.issued || row.createdat || row.date || null;
      const rawExpiresAt = row.expiresat || row.expiresdate || row.expires || row.validthru || null;

      cards.push({
        serialId,
        fullName,
        gender,
        robloxUsername,
        robloxUserId,
        assignedRank,
        division,
        clearanceLevel,
        status,
        discordId,
        discordTag,
        issuedAt: rawIssuedAt,
        expiresAt: rawExpiresAt,
      });
    }
  } else {
    // Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(rawStr);
    } catch (jErr) {
      return { cards: [], isUnmarkedFormat: false, error: `Invalid JSON format: ${jErr.message}` };
    }

    let cardCandidates = [];
    if (Array.isArray(parsed)) {
      cardCandidates = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.cards)) {
        cardCandidates = parsed.cards;
      } else if (parsed.cards && typeof parsed.cards === 'object') {
        cardCandidates = Object.values(parsed.cards);
      } else if (parsed.serverCards && typeof parsed.serverCards === 'object') {
        for (const guildMap of Object.values(parsed.serverCards)) {
          if (guildMap && typeof guildMap === 'object') {
            cardCandidates.push(...Object.values(guildMap));
          }
        }
      } else if (parsed.fullName || parsed.serialId || parsed.assignedRank) {
        cardCandidates = [parsed];
      } else {
        const vals = Object.values(parsed);
        if (vals.length > 0 && typeof vals[0] === 'object' && (vals[0].fullName || vals[0].serialId)) {
          cardCandidates = vals;
        }
      }
    }

    for (const c of cardCandidates) {
      if (!c || typeof c !== 'object') continue;
      cards.push({ ...c });
    }
  }

  let unmarkedCount = 0;
  for (const c of cards) {
    if (!c.issuedAt || isNaN(new Date(c.issuedAt).getTime())) {
      unmarkedCount++;
    }
  }
  if (unmarkedCount > 0) {
    isUnmarkedFormat = true;
  }

  return { cards, isUnmarkedFormat, total: cards.length, unmarkedCount };
}

export function flushCardsDbSync() {
  if (!_cachedCardsDb || !_cardsIsDirty) return;
  ensureDirectories();
  const tmpPath = `${DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(_cachedCardsDb, null, 2), 'utf8');
    fs.renameSync(tmpPath, DB_FILE);
    _cardsIsDirty = false;
  } catch (_) {}
}

try {
  process.on('beforeExit', flushCardsDbSync);
  process.on('SIGINT', () => { flushCardsDbSync(); process.exit(0); });
  process.on('SIGTERM', () => { flushCardsDbSync(); process.exit(0); });
} catch (_) {}

export function loadDatabase(forceReload = false) {
  if (_cachedCardsDb && !forceReload) {
    return _cachedCardsDb;
  }

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

  // Multi-Server Card Isolation Migration:
  // Migrate any legacy flat cards into server-partitioned keys
  parsed.serverCards = parsed.serverCards || {};
  if (parsed.cards && typeof parsed.cards === 'object') {
    for (const [key, card] of Object.entries(parsed.cards)) {
      if (card && card.guildId && !key.includes('_')) {
        const gId = card.guildId;
        const uId = card.discordId || key;
        const compKey = `${gId}_${uId}`;
        parsed.cards[compKey] = card;
        parsed.serverCards[gId] = parsed.serverCards[gId] || {};
        parsed.serverCards[gId][uId] = card;
        if (card.serialId) {
          parsed.serToUser = parsed.serToUser || {};
          parsed.serToUser[card.serialId] = { userId: uId, guildId: gId };
        }
        delete parsed.cards[key];
      }
    }
  }

  _cachedCardsDb = parsed;
  return parsed;
}

export function saveDatabase(db) {
  _cachedCardsDb = db;
  _cardsIsDirty = true;

  if (_cardsSaveTimeout) clearTimeout(_cardsSaveTimeout);
  _cardsSaveTimeout = setTimeout(() => {
    ensureDirectories();
    const tmpPath = `${DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(_cachedCardsDb, null, 2), 'utf8');
      fs.renameSync(tmpPath, DB_FILE);
      _cardsIsDirty = false;
    } catch (err) {
      console.error('[UOI Bot] Error saving database:', err.message);
    }
  }, 50);

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


/**
 * Server-isolated card lookup:
 * Returns the card for a specific user within a specific guild (server).
 */
export function getGuildCard(db, guildId, userId) {
  if (!db || !userId) return null;
  // 1. Check nested server structure: db.serverCards[guildId][userId]
  if (guildId && db.serverCards && db.serverCards[guildId] && db.serverCards[guildId][userId]) {
    return db.serverCards[guildId][userId];
  }
  // 2. Check composite key: db.cards[`${guildId}_${userId}`]
  if (guildId && db.cards && db.cards[`${guildId}_${userId}`]) {
    return db.cards[`${guildId}_${userId}`];
  }
  // 3. Check legacy flat db.cards[userId] ONLY if card.guildId matches this guildId
  if (db.cards && db.cards[userId]) {
    const legacyCard = db.cards[userId];
    if (guildId && legacyCard.guildId && legacyCard.guildId === guildId) {
      return legacyCard;
    }
  }
  return null;
}

/**
 * Server-isolated card store:
 * Stores the card specifically scoped to this guild and user.
 */
export function setGuildCard(db, guildId, userId, cardRecord) {
  if (!db || !userId) return;
  cardRecord.guildId = guildId || cardRecord.guildId || null;

  if (guildId) {
    db.serverCards = db.serverCards || {};
    db.serverCards[guildId] = db.serverCards[guildId] || {};
    db.serverCards[guildId][userId] = cardRecord;

    db.cards = db.cards || {};
    db.cards[`${guildId}_${userId}`] = cardRecord;
    if (db.cards[userId] && db.cards[userId].guildId === guildId) {
      delete db.cards[userId];
    }
  } else {
    db.cards = db.cards || {};
    db.cards[userId] = cardRecord;
  }

  if (cardRecord.serialId) {
    db.serToUser = db.serToUser || {};
    db.serToUser[cardRecord.serialId] = {
      userId,
      guildId: guildId || null,
    };
  }
}

/**
 * Resolve a card by its unique Serial ID across all servers.
 */
export function resolveCardBySerial(db, serial) {
  if (!db || !serial) return null;
  const s = String(serial).trim().toUpperCase();
  const entry = db.serToUser?.[s];

  if (entry) {
    if (typeof entry === 'object' && entry.userId) {
      const found = getGuildCard(db, entry.guildId, entry.userId);
      if (found) return found;
    } else if (typeof entry === 'string') {
      const all = getAllGuildCards(db);
      const match = all.find((c) => c.serialId?.toUpperCase() === s);
      if (match) return match;
      if (db.cards?.[entry] && db.cards[entry].serialId?.toUpperCase() === s) {
        return db.cards[entry];
      }
    }
  }

  // Fallback scan across all cards
  const allCards = getAllGuildCards(db);
  return allCards.find((c) => c.serialId?.toUpperCase() === s) || null;
}

/**
 * Returns all cards for a specific guild, or all cards globally if guildId is null.
 */
export function getAllGuildCards(db, guildId = null) {
  if (!db) return [];
  const list = [];
  const seenSerials = new Set();

  if (db.serverCards && typeof db.serverCards === 'object') {
    for (const [gId, userMap] of Object.entries(db.serverCards)) {
      if (guildId && gId !== guildId) continue;
      if (userMap && typeof userMap === 'object') {
        for (const card of Object.values(userMap)) {
          if (card && card.serialId && !seenSerials.has(card.serialId)) {
            seenSerials.add(card.serialId);
            list.push(card);
          }
        }
      }
    }
  }

  if (db.cards && typeof db.cards === 'object') {
    for (const [key, card] of Object.entries(db.cards)) {
      if (!card || !card.serialId || seenSerials.has(card.serialId)) continue;
      if (guildId) {
        if (card.guildId && card.guildId !== guildId) continue;
        if (key.includes('_') && !key.startsWith(`${guildId}_`)) continue;
      }
      seenSerials.add(card.serialId);
      list.push(card);
    }
  }

  return list;
}

// Roblox Account Resolution & Multi-Tier Auto-Detection are imported directly from ../roblox_detector.js

// resolveTemplateImage is imported directly from ../template_manager.js with 1-per-server isolation and auto-default generation

// Helper: Generate real scannable Code 128 barcode buffer
async function generateBarcodeImageBuffer(text) {
  if (!text) return null;
  try {
    const bwipMod = await import('bwip-js');
    const bwipjs = bwipMod?.default || bwipMod;
    if (!bwipjs || typeof bwipjs.toBuffer !== 'function') return null;

    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: String(text).trim().toUpperCase(),
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: 'center',
      textsize: 11,
      textyoffset: 4,
      textcolor: '0a0f1d',
      barcolor: '0a0f1d',
      backgroundcolor: 'ffffff',
      paddingwidth: 12,
      paddingheight: 4,
    });
    return barcodeBuffer;
  } catch (err) {
    console.warn('[UOI Bot] Real barcode generation warning:', err?.message || err);
    return null;
  }
}


// Helper: Generate real high-density verification QR code buffer
export async function generateQrCodeImageBuffer(text) {
  if (!text) return null;
  try {
    const bwipMod = await import('bwip-js');
    const bwipjs = bwipMod?.default || bwipMod;
    if (!bwipjs || typeof bwipjs.toBuffer !== 'function') return null;

    const qrBuffer = await bwipjs.toBuffer({
      bcid: 'qrcode',
      text: String(text).trim(),
      scale: 3,
      padding: 1,
    });
    return qrBuffer;
  } catch (err) {
    console.warn('[UOI Bot] Real QR code generation warning:', err?.message || err);
    return null;
  }
}

// Helper: Determine Security Clearance Level from Rank and Division
export function computeClearanceLevel(rank, division) {
  const r = (rank || '').toUpperCase();
  const d = (division || '').toUpperCase();
  if (r.includes('PRESIDENT') || r.includes('PRIME MINISTER') || r.includes('DIRECTOR') || d.includes('HIGH COMMAND')) {
    return 'LEVEL V (UNION DIRECTORATE)';
  }
  if (r.includes('COMMANDANT') || r.includes('GENERAL') || r.includes('COLONEL') || r.includes('CHIEF') || r.includes('ADMIN')) {
    return 'LEVEL IV (EXECUTIVE SECURE)';
  }
  if (r.includes('OFFICER') || r.includes('SECURITY') || r.includes('INSPECTOR') || r.includes('CAPTAIN') || d.includes('SECURITY') || d.includes('ARMED')) {
    return 'LEVEL III (SECURITY OPERATIVE)';
  }
  if (r.includes('CADET') || r.includes('CONSTABLE') || r.includes('STAFF') || r.includes('SPECIALIST') || d.includes('CIVIL')) {
    return 'LEVEL II (CIVIL SERVICE)';
  }
  return 'LEVEL I (GENERAL CITIZEN)';
}

// Helper: Dispatch Audit Log Embed to designated Audit Channel
export async function dispatchAuditLog(guild, guildConfig, { event, citizenUser, officerUser, serialId, reason, fields = [] }) {
  if (!guild) return;
  try {
    let auditChannel = null;
    if (guildConfig?.auditChannelId) {
      auditChannel = await guild.channels.fetch(guildConfig.auditChannelId).catch(() => null);
    }
    if (!auditChannel && guild.channels?.cache) {
      auditChannel = guild.channels.cache.find(c =>
        c.isTextBased && c.isTextBased() &&
        /card[-_]?logs|registry[-_]?logs|audit[-_]?log/i.test(c.name)
      );
    }
    if (!auditChannel || !auditChannel.isTextBased()) return;

    const eventColors = {
      CARD_ISSUED: 0x10b981,
      CARD_DECLINED: 0xef4444,
      CARD_PROMOTED: 0x3b82f6,
      CARD_REVOKED: 0xdc2626,
      CARD_REFRESHED: 0x06b6d4,
    };

    const embed = new EmbedBuilder()
      .setTitle(`📜 Registry Audit: ${event.replace('_', ' ')}`)
      .setColor(eventColors[event] || 0x38bdf8)
      .addFields(
        { name: 'Event', value: `\`${event}\``, inline: true },
        { name: 'Citizen', value: citizenUser ? `<@${citizenUser.id || citizenUser}>` : 'N/A', inline: true },
        { name: 'Officer', value: officerUser ? `<@${officerUser.id || officerUser}>` : 'System', inline: true },
      );

    if (serialId) embed.addFields({ name: 'Serial ID', value: `\`${serialId}\``, inline: true });
    if (reason) embed.addFields({ name: 'Reason / Justification', value: reason });
    if (fields.length) embed.addFields(...fields);

    embed.setFooter({ text: 'UOI Central Registry Security Audit' }).setTimestamp();
    await auditChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.warn('[UOI Bot] Error dispatching audit log:', err.message);
  }
}

// Helper: Render official 1200x900 UOI Citizen ID Card
export async function renderCardImage({
  guildId,
  fullName,
  robloxUsername,
  robloxUserId,
  gender,
  assignedRank,
  serialId,
  avatarUrl,
  division = null,
  clearanceLevel = null,
  issuedAt = null,
  issuedOfficerTag = null,
  isServerSpecific = false,
  serverName = null,
  theme = null,
  effect = null,
}) {
  if (!createCanvas || typeof createCanvas !== 'function') {
    return { buffer: null, usedTemplate: false, source: 'canvas-library-disabled' };
  }

  const { theme: activeTheme, effect: activeEffect } = resolveCardVisualTheme(theme, effect);

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
      ctx.fillStyle = activeTheme.primary || '#38BDF8';
      ctx.font = 'bold 14px "Nimbus Mono PS", "Liberation Mono", "Courier New", Courier, monospace';
      ctx.fillText(serialId, 1010, 36);
      ctx.restore();

      // Server-Specific Credential Badge / Flag on Card Graphic
      if (isServerSpecific) {
        ctx.save();
        const badgeX = 875;
        const badgeY = 46;
        const badgeW = 270;
        const badgeH = 26;

        ctx.fillStyle = 'rgba(8, 13, 25, 0.90)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
        } else {
          ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();

        ctx.strokeStyle = '#F59E0B'; // Gold border
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Status indicator dot
        ctx.fillStyle = '#10B981'; // Emerald
        ctx.beginPath();
        ctx.arc(badgeX + 13, badgeY + 13, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#F8FAFC';
        ctx.font = 'bold 10px "Liberation Sans", -apple-system, sans-serif';
        const displayLabel = `SERVER-SPECIFIC • ${(serverName || 'LOCAL JURISDICTION').toUpperCase().slice(0, 16)}`;
        ctx.fillText(displayLabel, badgeX + 24, badgeY + 17);
        ctx.restore();
      }

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
      ctx.strokeStyle = activeTheme.border || '#F59E0B';
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

      // 6. REAL SCANNABLE BARCODE (Code 128)
      // Generates and stamps a live, scannable Code 128 barcode directly onto the card
      try {
        const barcodeBuffer = await generateBarcodeImageBuffer(serialId);
        if (barcodeBuffer) {
          const barcodeImg = await safeLoadImage(barcodeBuffer);
          if (barcodeImg) {
            const bBoxX = 54;
            const bBoxY = 758;
            const bBoxW = 348;
            const bBoxH = 100;

            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(bBoxX, bBoxY, bBoxW, bBoxH, 4);
            } else {
              ctx.rect(bBoxX, bBoxY, bBoxW, bBoxH);
            }
            ctx.fill();

            // Accent border matching selected card theme
            ctx.strokeStyle = activeTheme.border || '#F59E0B';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Scale and center the barcode cleanly inside the white container
            const padding = 6;
            const availW = bBoxW - padding * 2;
            const availH = bBoxH - padding * 2;
            const scale = Math.min(availW / barcodeImg.width, availH / barcodeImg.height);
            const drawW = Math.round(barcodeImg.width * scale);
            const drawH = Math.round(barcodeImg.height * scale);
            const drawX = Math.round(bBoxX + (bBoxW - drawW) / 2);
            const drawY = Math.round(bBoxY + (bBoxH - drawH) / 2);

            ctx.drawImage(barcodeImg, drawX, drawY, drawW, drawH);
            ctx.restore();
          }
        }
      } catch (bcErr) {
        console.warn('[UOI Bot] Warning rendering real barcode:', bcErr?.message || bcErr);
      }

      // Compute Extended Identity & Security Metadata
      const clearance = clearanceLevel || computeClearanceLevel(assignedRank, division);
      const effectiveDivision = (division || (
        (assignedRank || '').includes('OFFICER') || (assignedRank || '').includes('SECURITY') || (assignedRank || '').includes('COMMAND')
          ? 'HOMELAND SECURITY & BORDER CORPS'
          : 'CIVILIAN DIRECTORATE'
      )).toUpperCase();
      const issueDate = issuedAt ? new Date(issuedAt) : new Date();
      const expiresDate = computeCardExpiration(issueDate);
      const isCardExpired = Date.now() >= expiresDate.getTime();
      const formattedIssue = issueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
      const formattedExpiry = 'VALID THRU: ' + expiresDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

      // Render Clearance, Division & Issue Dates on the right-hand identity panel
      ctx.save();
      ctx.fillStyle = activeTheme.primary || '#F59E0B';
      ctx.font = 'bold 13px "Liberation Sans", -apple-system, sans-serif';
      ctx.fillText(`CLEARANCE: ${clearance}`, fieldX + 18, 752);

      ctx.fillStyle = activeTheme.secondary || '#38BDF8';
      ctx.font = 'bold 12px "Liberation Sans", -apple-system, sans-serif';
      ctx.fillText(`DIVISION: ${effectiveDivision}`, fieldX + 18, 772);

      if (isCardExpired) {
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 12px "Nimbus Mono PS", monospace';
        ctx.fillText(`ISSUED: ${formattedIssue} • ⚠️ EXPIRED (${formattedExpiry})`, fieldX + 18, 792);
      } else {
        ctx.fillStyle = '#94A3B8';
        ctx.font = 'bold 12px "Nimbus Mono PS", monospace';
        ctx.fillText(`ISSUED: ${formattedIssue} • ${formattedExpiry}`, fieldX + 18, 792);
      }
      ctx.restore();

      // 7. REAL HIGH-DENSITY VERIFICATION QR CODE (Bottom-Right Panel)
      try {
        const verifyUrl = `https://uoi-gov.in/verify?serial=${serialId}`;
        const qrBuffer = await generateQrCodeImageBuffer(verifyUrl);
        if (qrBuffer) {
          const qrImg = await safeLoadImage(qrBuffer);
          if (qrImg) {
            const qrX = 1044;
            const qrY = 744;
            const qrW = 102;
            const qrH = 102;

            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(qrX, qrY, qrW, qrH, 6);
            } else {
              ctx.rect(qrX, qrY, qrW, qrH);
            }
            ctx.fill();
            ctx.strokeStyle = activeTheme.border || '#F59E0B';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            const p = 5;
            ctx.drawImage(qrImg, qrX + p, qrY + p, qrW - p * 2, qrH - p * 2);

            ctx.fillStyle = '#94A3B8';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('SCAN TO VERIFY', qrX + qrW / 2, qrY + qrH + 12);
            ctx.restore();
          }
        }
      } catch (qrErr) {
        console.warn('[UOI Bot] Warning rendering QR code:', qrErr?.message || qrErr);
      }

      // 8. SECURITY MICROTEXT BAND (Bottom border)
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = 'bold 8.5px "Nimbus Mono PS", "Liberation Mono", monospace';
      ctx.fillText('UNION OF INDIANS CITIZEN IDENTITY DOCUMENT • GOVERNMENT OF UOI • SCAN BARCODE OR QR CODE FOR LIVE AUTHENTICITY RECORD', 54, 882);
      ctx.restore();
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

      if (isServerSpecific) {
        ctx.save();
        const badgeX = 820;
        const badgeY = 108;
        const badgeW = 320;
        const badgeH = 28;

        ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
        } else {
          ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#34D399';
        ctx.beginPath();
        ctx.arc(badgeX + 14, badgeY + 14, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 11px monospace';
        const sName = (serverName || 'LOCAL').toUpperCase().slice(0, 18);
        ctx.fillText(`SERVER-SPECIFIC • ${sName}`, badgeX + 26, badgeY + 18);
        ctx.restore();
      }

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

      // Real scannable barcode in fallback design
      try {
        const barcodeBuffer = await generateBarcodeImageBuffer(serialId);
        if (barcodeBuffer) {
          const barcodeImg = await safeLoadImage(barcodeBuffer);
          if (barcodeImg) {
            const bBoxX = 56;
            const bBoxY = 665;
            const bBoxW = 345;
            const bBoxH = 95;

            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(bBoxX, bBoxY, bBoxW, bBoxH, 6);
            } else {
              ctx.rect(bBoxX, bBoxY, bBoxW, bBoxH);
            }
            ctx.fill();
            ctx.strokeStyle = '#F59E0B';
            ctx.lineWidth = 2;
            ctx.stroke();

            const padding = 6;
            const scale = Math.min((bBoxW - padding * 2) / barcodeImg.width, (bBoxH - padding * 2) / barcodeImg.height);
            const drawW = Math.round(barcodeImg.width * scale);
            const drawH = Math.round(barcodeImg.height * scale);
            const drawX = Math.round(bBoxX + (bBoxW - drawW) / 2);
            const drawY = Math.round(bBoxY + (bBoxH - drawH) / 2);

            ctx.drawImage(barcodeImg, drawX, drawY, drawW, drawH);
            ctx.restore();
          }
        }
      } catch (_) {}
    }

    // 9. Apply Selected Card Visual Security Effect (Holographic Foil, Gold Embossed, Stealth)
    if (activeEffect.key === 'holographic') {
      ctx.save();
      const holoGrad = ctx.createLinearGradient(0, 0, 1200, 900);
      holoGrad.addColorStop(0, 'rgba(255, 0, 128, 0.05)');
      holoGrad.addColorStop(0.2, 'rgba(255, 215, 0, 0.07)');
      holoGrad.addColorStop(0.4, 'rgba(0, 255, 200, 0.05)');
      holoGrad.addColorStop(0.6, 'rgba(0, 150, 255, 0.07)');
      holoGrad.addColorStop(0.8, 'rgba(180, 0, 255, 0.05)');
      holoGrad.addColorStop(1, 'rgba(255, 100, 0, 0.05)');
      ctx.fillStyle = holoGrad;
      ctx.fillRect(0, 0, 1200, 900);

      // Security fine guilloche curve watermark
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      for (let y = 80; y < 900; y += 45) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(400, y - 25, 800, y + 25, 1200, y);
        ctx.stroke();
      }
      ctx.restore();
    } else if (activeEffect.key === 'gold_embossed') {
      ctx.save();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, 1180, 880);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(16, 16, 1168, 868);
      ctx.restore();
    } else if (activeEffect.key === 'stealth') {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, 1200, 900);
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 12, 1176, 876);
      ctx.restore();
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


/**
 * Determines if the interacting user is an authorized Owner:
 * 1. Configured OWNER_ID / BOT_OWNER_ID in .env
 * 2. Discord Server (Guild) Owner
 * 3. Discord Bot Application Owner / Team Member
 */
export async function checkIsOwner(interaction) {
  const userId = interaction.user?.id;
  if (!userId) return false;

  // 1. Configured Bot Owner ID(s) via environment
  const envOwners = (process.env.OWNER_ID || process.env.BOT_OWNER_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (envOwners.includes(userId)) return true;

  // 2. Server / Guild Owner
  if (interaction.guild && interaction.guild.ownerId === userId) {
    return true;
  }

  // 3. Discord Bot Application Owner / Team Member
  try {
    if (!interaction.client?.application?.owner) {
      await interaction.client?.application?.fetch();
    }
    const appOwner = interaction.client?.application?.owner;
    if (appOwner) {
      if (appOwner.id === userId) return true;
      if (appOwner.members && typeof appOwner.members.has === "function" && appOwner.members.has(userId)) return true;
      if (appOwner.ownerId === userId) return true;
    }
  } catch {
    // Non-fatal if fetch fails
  }

  return false;
}

/**
 * Automatically scans a guild member's Discord roles to determine their official citizen rank.
 * Prioritizes hoisted, colored, or senior hierarchy roles.
 * Filters out @everyone, bot roles, server booster, muted, or default utility roles.
 */
export function resolveCitizenRankFromRoles(member) {
  if (!member || !member.roles || !member.roles.cache) {
    return {
      rankName: 'CITIZEN',
      roleId: null,
      roleName: 'Citizen',
      isHoisted: false,
      scannedRolesCount: 0,
      allRoles: [],
    };
  }

  // Get all roles except @everyone (supports Collection, Map, and Array)
  const rawCache = member.roles.cache;
  const rawList = typeof rawCache.values === 'function'
    ? Array.from(rawCache.values())
    : (Array.isArray(rawCache) ? rawCache : []);

  const roles = rawList.filter((r) => r && r.id !== member.guild?.id && r.name !== '@everyone');
  if (roles.length === 0) {
    return {
      rankName: 'CITIZEN',
      roleId: null,
      roleName: 'Citizen',
      isHoisted: false,
      scannedRolesCount: 0,
      allRoles: [],
    };
  }

  // Filter out system / bot integration / server booster / utility roles
  const filteredRoles = roles.filter((r) => {
    if (r.managed) return false;
    if (r.tags?.premiumSubscriberRole) return false;
    const lower = (r.name || '').toLowerCase();
    if (
      lower.includes('muted') ||
      lower.includes('quarantine') ||
      lower.includes('jail') ||
      lower.includes('bot') ||
      lower.includes('unverified')
    ) {
      return false;
    }
    return true;
  });

  const pool = filteredRoles.length > 0 ? filteredRoles : roles;

  // Sort by Discord role hierarchy position descending (highest position first)
  const sorted = [...pool].sort((a, b) => (b.position || 0) - (a.position || 0));

  // Prefer hoisted role if one exists, otherwise take highest positioned role
  const hoistedRole = sorted.find((r) => r.hoist);
  const primaryRole = hoistedRole || sorted[0];

  if (primaryRole) {
    // Sanitize role name (strip decorative emojis if any, keep clean uppercase title)
    const cleanName = primaryRole.name
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/[^a-zA-Z0-9\s\-_/]/g, '')
      .trim()
      .toUpperCase();

    return {
      rankName: cleanName.length >= 2 ? cleanName : primaryRole.name.toUpperCase().trim(),
      roleId: primaryRole.id,
      roleName: primaryRole.name,
      isHoisted: Boolean(primaryRole.hoist),
      scannedRolesCount: roles.length,
      allRoles: roles.map((r) => r.name),
    };
  }

  return {
    rankName: 'CITIZEN',
    roleId: null,
    roleName: 'Citizen',
    isHoisted: false,
    scannedRolesCount: 0,
    allRoles: [],
  };
}

/**
 * Determines if the interacting user has Staff, Officer, Admin, or Owner permissions
 */
export async function checkIsStaffOrAdmin(interaction, guildConfig) {
  if (await checkIsOwner(interaction)) return true;
  const hasAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  const hasManage =
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
  const hasStaffRole =
    guildConfig?.staffRoleId &&
    interaction.member?.roles?.cache?.has(guildConfig.staffRoleId);
  return Boolean(hasAdmin || hasManage || hasStaffRole);
}

/**
 * Determines if the interacting user is strictly the Server Owner or an Administrator.
 * Used to safeguard card export, import, and permanent database operations.
 */
export async function checkIsOwnerOrAdmin(interaction) {
  if (await checkIsOwner(interaction)) return true;
  const hasAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(hasAdmin);
}

/**
 * Proactively checks all cards across all servers for 2-month expiration.
 * Dispatches automated DMs to cardholders at 10, 5, 3, and 1 days prior,
 * as well as a final expiration notice upon expiration (0 days).
 */
export async function checkAndDispatchCardExpirations(client) {
  if (!client || !client.isReady()) return;
  const db = loadDatabase();
  const allCards = getAllGuildCards(db);
  const now = Date.now();
  let dbDirty = false;

  for (const card of allCards) {
    if (!card || !card.discordId) continue;
    if (card.status === 'REVOKED') continue;

    // Ensure card has timestamps
    if (!card.issuedAt || !card.expiresAt) {
      stampCardTimestamps(card);
      dbDirty = true;
    }

    const expiresTime = new Date(card.expiresAt).getTime();
    if (isNaN(expiresTime)) continue;

    const diffMs = expiresTime - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    card.remindersSent = card.remindersSent || {
      d10: false,
      d5: false,
      d3: false,
      d1: false,
      expired: false,
    };

    let reminderType = null;
    let daysLabel = '';
    let alertColor = 0xf59e0b;

    if (diffDays <= 0 && !card.remindersSent.expired) {
      reminderType = 'expired';
      daysLabel = '0 days (EXPIRED)';
      alertColor = 0xdc2626; // Dark Red
      card.remindersSent.expired = true;
      card.remindersSent.d1 = true;
      card.remindersSent.d3 = true;
      card.remindersSent.d5 = true;
      card.remindersSent.d10 = true;
      card.status = 'EXPIRED';
      dbDirty = true;
    } else if (diffDays <= 1 && diffDays > 0 && !card.remindersSent.d1) {
      reminderType = 'd1';
      daysLabel = '1 day (24 Hours Remaining)';
      alertColor = 0xef4444; // Red
      card.remindersSent.d1 = true;
      card.remindersSent.d3 = true;
      card.remindersSent.d5 = true;
      card.remindersSent.d10 = true;
      dbDirty = true;
    } else if (diffDays <= 3 && diffDays > 1 && !card.remindersSent.d3) {
      reminderType = 'd3';
      daysLabel = '3 days remaining';
      alertColor = 0xf97316; // Orange
      card.remindersSent.d3 = true;
      card.remindersSent.d5 = true;
      card.remindersSent.d10 = true;
      dbDirty = true;
    } else if (diffDays <= 5 && diffDays > 3 && !card.remindersSent.d5) {
      reminderType = 'd5';
      daysLabel = '5 days remaining';
      alertColor = 0xf59e0b; // Amber / Gold
      card.remindersSent.d5 = true;
      card.remindersSent.d10 = true;
      dbDirty = true;
    } else if (diffDays <= 10 && diffDays > 5 && !card.remindersSent.d10) {
      reminderType = 'd10';
      daysLabel = '10 days remaining';
      alertColor = 0xeab308; // Yellow-Gold
      card.remindersSent.d10 = true;
      dbDirty = true;
    }

    if (reminderType) {
      try {
        let user = null;
        try {
          user = await client.users.fetch(card.discordId);
        } catch (_) {}

        if (user) {
          const serverName = card.guildId && db.guilds?.[card.guildId]?.name
            ? db.guilds[card.guildId].name
            : 'Union of Indians';
          const expiresUnix = Math.floor(expiresTime / 1000);
          const issuedUnix = Math.floor(new Date(card.issuedAt).getTime() / 1000);

          const isExp = reminderType === 'expired';
          const title = isExp
            ? `🔴 UOI Citizen Card Expired: ${card.fullName}`
            : `⚠️ UOI Citizen Card Expiration Notice (${daysLabel}): ${card.fullName}`;

          const desc = isExp
            ? `Your Union of Indians identification card registered in **${serverName}** has reached its **2-month expiration date** and is now **EXPIRED**.\n\n` +
              `To maintain verified citizen privileges, access rights, and server credentials, please reapply or refresh your card immediately.`
            : `Your Union of Indians identification card registered in **${serverName}** is set to expire in **${daysLabel}**.\n\n` +
              `Under Union security protocol, all citizen cards have a **2-month validity window**. Please review your card details below and prepare to refresh or reapply.`;

          const dmEmbed = new EmbedBuilder()
            .setTitle(title)
            .setColor(alertColor)
            .setDescription(desc)
            .addFields(
              { name: '🆔 Serial ID', value: `\`${card.serialId}\``, inline: true },
              { name: '👤 Citizen Name', value: card.fullName || 'Citizen', inline: true },
              { name: '🏛️ Server Registry', value: serverName, inline: true },
              { name: '🎖️ Assigned Rank', value: `**${card.assignedRank || 'Citizen'}**`, inline: true },
              { name: '📅 Issued At', value: `<t:${issuedUnix}:d> (<t:${issuedUnix}:R>)`, inline: true },
              { name: '⏳ Expiration Date', value: `<t:${expiresUnix}:F> (<t:${expiresUnix}:R>)`, inline: true },
              {
                name: '🔄 How to Renew / Reapply',
                value:
                  `• Run \`/card refresh\` in **${serverName}** to instantly sync your role & avatar.\n` +
                  `• Or run \`/card apply\` to submit a renewal application to staff.\n` +
                  `• Run \`/card show\` anytime to view your current credential status.`,
                inline: false,
              }
            )
            .setFooter({ text: `UOI Automated Expiry Sentinel • Notice: ${daysLabel}` })
            .setTimestamp();

          await user.send({ embeds: [dmEmbed] }).catch((dmErr) => {
            console.warn(`[UOI Bot] Could not send expiration DM to ${card.discordId}:`, dmErr.message);
          });
          console.log(`[UOI Bot] 📬 Dispatched ${reminderType} expiration notice DM to <@${card.discordId}> (Serial: ${card.serialId})`);
        }
      } catch (dmErr) {
        console.warn(`[UOI Bot] Error dispatching expiration DM to ${card.discordId}:`, dmErr.message);
      }
    }
  }

  if (dbDirty) {
    saveDatabase(db);
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
        .setDescription('Configure UOI ID Card routing and review channels for this server (Admins & Owner)')
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
        .addRoleOption((opt) =>
          opt
            .setName('verified_role')
            .setDescription('Role to grant automatically when a citizen card is approved (e.g. @Citizen)')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('audit_channel')
            .setDescription('Channel where card logs (approvals, promotions, revocations) are sent')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('auto_nickname')
            .setDescription('Automatically update member nickname to "Name [Serial]" upon approval (Default: True)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('bloxlink_api_key')
            .setDescription('Bloxlink API Key for instant 100% cryptographic Roblox verification (Optional)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('rover_api_key')
            .setDescription('RoVer API Key for instant 100% cryptographic Roblox verification (Optional)')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('application_expiry_hours')
            .setDescription('Hours before an unreviewed card application expires (Default: 48)')
            .setMinValue(1)
            .setMaxValue(336)
            .setRequired(false)
        )
    )
    // 1. /card generate (Unified: Opens interactive modal if empty, or accepts direct slash options)
    .addSubcommand((sub) =>
      sub
        .setName('generate')
        .setDescription('Apply for or issue a Citizen ID Card (Opens modal form, or supply options directly)')
        .addStringOption((opt) =>
          opt.setName('fullname').setDescription('Full Citizen Name (Leave blank to open interactive modal form!)').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('gender').setDescription('Gender (Male / Female / Other)').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('roblox')
            .setDescription('Roblox Username/ID (Optional - auto-detects from profile/nickname)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('division')
            .setDescription('Civilian Directorate, Armed Forces, or Homeland Security (Optional)')
            .setRequired(false)
        )
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member (leave empty to apply for yourself)').setRequired(false)
        )
    )
    // 2. /card refresh (Citizen Self-Service Avatar & Role Synchronizer)
    .addSubcommand((sub) =>
      sub
        .setName('refresh')
        .setDescription('Refresh your active card with your latest Roblox avatar & Discord server role')
    )
    // 3. /card export (Download Card Files - Owner / Admin Only)
    .addSubcommand((sub) =>
      sub
        .setName('export')
        .setDescription('Download card database files with timestamps and 2-month expiry (Owner / Admin Only)')
        .addStringOption((opt) =>
          opt
            .setName('format')
            .setDescription('File format to download (JSON database dump or CSV spreadsheet)')
            .addChoices(
              { name: '📦 JSON Database File (Complete Data & Metadata)', value: 'json' },
              { name: '📊 CSV Spreadsheet (Excel / Google Sheets Compatible)', value: 'csv' }
            )
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('scope')
            .setDescription('Scope of cards to export (This server only or network-wide)')
            .addChoices(
              { name: '🏛️ This Server Only [Default]', value: 'this_server' },
              { name: '🌐 All Servers (Network-Wide Central Registry)', value: 'all_servers' }
            )
            .setRequired(false)
        )
    )
    // 3b. /card import (Upload Card Files - Multiple Files & Unmarked Format Support)
    .addSubcommand((sub) =>
      sub
        .setName('import')
        .setDescription('Upload card files (multiple files, auto-marks unmarked format) (Owner / Admin Only)')
        .addAttachmentOption((opt) =>
          opt.setName('file').setDescription('Primary card file to upload (.json or .csv)').setRequired(true)
        )
        .addAttachmentOption((opt) =>
          opt.setName('file2').setDescription('Second card file to upload (Optional)').setRequired(false)
        )
        .addAttachmentOption((opt) =>
          opt.setName('file3').setDescription('Third card file to upload (Optional)').setRequired(false)
        )
        .addAttachmentOption((opt) =>
          opt.setName('file4').setDescription('Fourth card file to upload (Optional)').setRequired(false)
        )
        .addAttachmentOption((opt) =>
          opt.setName('file5').setDescription('Fifth card file to upload (Optional)').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Import mode (Merge: add/update cards, Replace: overwrite this server cards)')
            .addChoices(
              { name: '🔄 Merge (Add new & update existing cards) [Default]', value: 'merge' },
              { name: '⚠️ Replace (Clear and replace cards for this server)', value: 'replace' }
            )
            .setRequired(false)
        )
    )
    // 4. /card whois (Roblox Auto-Detection & Identity Dossier)
    .addSubcommand((sub) =>
      sub
        .setName('whois')
        .setDescription('Auto-detect and inspect linked Roblox account, 3D avatar headshot, and verified identity')
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member to inspect (leave empty to check yourself)')
        )
        .addStringOption((opt) =>
          opt.setName('roblox').setDescription('Or manually query a specific Roblox username or user ID')
        )
    )
    // 5. /card link (Permanently link Discord account to Roblox profile)
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Permanently link your Discord account to your verified Roblox profile')
        .addStringOption((opt) =>
          opt
            .setName('roblox')
            .setDescription('Your exact Roblox username or Numerical User ID')
            .setRequired(true)
        )
        .addUserOption((opt) =>
          opt
            .setName('citizen')
            .setDescription('Citizen to link (Officers only - defaults to yourself)')
            .setRequired(false)
        )
    )
    // 6. /card unlink (Unlink Roblox profile)
    .addSubcommand((sub) =>
      sub
        .setName('unlink')
        .setDescription('Unlink your registered Roblox profile from your Discord account')
        .addUserOption((opt) =>
          opt
            .setName('citizen')
            .setDescription('Citizen to unlink (Officers only - defaults to yourself)')
            .setRequired(false)
        )
    )
    // 7. /card show (Pulls official card from database with graphical rendering)
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Display an official UOI ID card from the database')
        .addUserOption((opt) =>
          opt.setName('citizen').setDescription('Target member to look up (leave empty to view your own card)')
        )
        .addStringOption((opt) =>
          opt
            .setName('theme')
            .setDescription('Card accent color theme (Imperial Gold, Cyan, Crimson, Emerald, Cyber, Matrix, etc.)')
            .setRequired(false)
            .addChoices(
              { name: '👑 Imperial Gold [Default]', value: 'gold' },
              { name: '💠 UOI Cyan', value: 'cyan' },
              { name: '🩸 Blood Crimson', value: 'crimson' },
              { name: '🌿 Forest Emerald', value: 'emerald' },
              { name: '🔮 Royal Amethyst', value: 'purple' },
              { name: '⚡ Cyberpunk Neon', value: 'cyber' },
              { name: '☣️ Toxic Matrix', value: 'matrix' },
              { name: '🌅 Sunset Blaze', value: 'sunset' },
              { name: '🌸 Sakura Blossom', value: 'sakura' },
              { name: '🖤 Obsidian Stealth', value: 'stealth' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('effect')
            .setDescription('Card visual security effect (Holographic Foil, Gold Embossed, Stealth)')
            .setRequired(false)
            .addChoices(
              { name: '✨ Clean Standard [Default]', value: 'standard' },
              { name: '🔮 Prismatic Holographic Foil', value: 'holographic' },
              { name: '👑 Gold Foil Embossed Frame', value: 'gold_embossed' },
              { name: '🖤 Tactical Stealth Dark Mode', value: 'stealth' }
            )
        )
    )
    // 8. /card set-template (1 template per server, supports reset)
    .addSubcommand((sub) =>
      sub
        .setName('set-template')
        .setDescription('Upload or update this server\'s official card template (1 per server)')
        .addAttachmentOption((opt) =>
          opt.setName('image').setDescription('Attach the official template image (PNG, JPG, or WebP)')
        )
        .addStringOption((opt) =>
          opt.setName('url').setDescription('Or paste a direct image URL (Discord CDN, Imgur, Drive, etc.)')
        )
        .addBooleanOption((opt) =>
          opt.setName('reset').setDescription('Set to True to remove custom template and revert to official default')
        )
    )
    // 9. /card view-template
    .addSubcommand((sub) =>
      sub
        .setName('view-template')
        .setDescription('View the current active card template for this server')
    )
    // 10. /card verify [serial_id]
    .addSubcommand((sub) =>
      sub
        .setName('verify')
        .setDescription('Verify the authenticity of an issued UOI card serial ID in database')
        .addStringOption((opt) =>
          opt.setName('serial').setDescription('e.g. UOI-2026-839201').setRequired(true)
        )
    )
    // 11. /card promote
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
    // 12. /card revoke
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
    // 13. /card botstyle (Custom Bot Name Styles including 10th Font Sinistre)
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
            .setDescription('Visual effect style (Default: Two-Tone Linear Gradient)')
            .setRequired(false)
            .addChoices(
              { name: '🌈 Gradient: Two-Tone Linear (Effect 2) [Default]', value: 2 },
              { name: '⚡ Neon Glow: Electric Luminescence (Effect 3)', value: 3 },
              { name: '🎨 Toon Outline: Comic Contour (Effect 4)', value: 4 },
              { name: '💥 Pop Accent: 3D Drop-Shadow (Effect 5)', value: 5 },
              { name: '🔮 Holographic: Prismatic Shimmer (Effect 6)', value: 6 },
              { name: '⚡ Cyberpunk: Glitch & Aura Pulse (Effect 7)', value: 7 },
              { name: '✨ Velvet Luxe: Ambient Radiance (Effect 8)', value: 8 },
              { name: '☀️ Sunburst: Radial Flare (Effect 9)', value: 9 },
              { name: '⬛ Solid: Clean Monochromatic (Effect 1)', value: 1 }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Color Theme Preset (25 rich options with dual-color gradients)')
            .setRequired(false)
            .addChoices(
              { name: '🇮🇳 Tricolor: Saffron & Forest Green [Default]', value: 'tiranga' },
              { name: '🇮🇳 Ashoka: Royal Navy & Deep Saffron', value: 'ashoka_navy' },
              { name: '⚡ Cyberpunk: Electric Cyan & Neon Blue', value: 'cyber_cyan' },
              { name: '👑 Imperial Gold: Warm Gold & Amber', value: 'imperial_gold' },
              { name: '🩸 Blood Crimson: Warning Red & Scarlet', value: 'blood_crimson' },
              { name: '🌿 Deep Emerald: Forest Green & Jade', value: 'emerald_forest' },
              { name: '🔮 Royal Amethyst: Cosmic Violet & Purple', value: 'royal_purple' },
              { name: '🌅 Sunset Blaze: Solar Orange & Coral', value: 'sunset_blaze' },
              { name: '☣️ Toxic Matrix: Acid Lime & Terminal Green', value: 'toxic_matrix' },
              { name: '🌌 Midnight Sapphire: Deep Navy & Cobalt', value: 'midnight_sapphire' },
              { name: '🌸 Sakura Blossom: Cherry Pink & Rose', value: 'sakura_blossom' },
              { name: '🖤 Obsidian Stealth: Matte Slate & Black', value: 'obsidian_stealth' },
              { name: '❄️ Arctic Glacier: Frost Teal & Ice White', value: 'arctic_glacier' },
              { name: '🔥 Plasma Fire: Molten Lava & Sunfire Orange', value: 'plasma_fire' },
              { name: '🌆 Synthwave Neon: Hot Magenta & Violet', value: 'synthwave_neon' },
              { name: '🛡️ Antique Bronze: Burnished Copper & Gold', value: 'bronze_copper' },
              { name: '🌌 Aurora Borealis: Northern Teal & Indigo', value: 'aurora_teal' },
              { name: '🍷 Velvet Wine: Velvet Ruby & Maroon', value: 'velvet_wine' },
              { name: '💠 UOI Cyan: Signature Government Cyan', value: 'uoi_cyan' },
              { name: '☀️ Solar Flare: Luminous Yellow & Saffron', value: 'solar_yellow' },
              { name: '🚀 Deep Nebula: Space Purple & Starlight Blue', value: 'deep_nebula' },
              { name: '👻 Platinum Ghost: Aerospace Platinum & Silver', value: 'platinum_ghost' },
              { name: '🌹 Ruby Rose: Bright Rose & Vivid Berry', value: 'ruby_rose' },
              { name: '🌊 Ocean Lagoon: Tropical Turquoise & Seafoam', value: 'ocean_lagoon' },
              { name: '✨ Golden Hour: Saffron Gold & Sunset Amber', value: 'golden_hour' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('custom_hex')
            .setDescription('Or enter ANY custom Primary Hex Color (e.g. #FF0055 or 00FFAA)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('custom_hex2')
            .setDescription('Optional Secondary Hex Color for custom 2-Tone Gradient (e.g. #3B82F6)')
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('reset')
            .setDescription('Reset bot display name to normal default appearance')
            .setRequired(false)
        )
    )
    // 14. /card memory (Inspect permanent memory & server setups)
    .addSubcommand((sub) =>
      sub
        .setName('memory')
        .setDescription('Inspect permanent server memory, saved channel setups, and storage health (Owner Only)')
    )
    // 15. /card git-status (Inspect Git commit hash and auto-deploy status)
    .addSubcommand((sub) =>
      sub
        .setName('git-status')
        .setDescription('Inspect Git commit hash, deploy status, and webhook pipeline (Owner Only)')
    )
    // 16. /card git-sync (Pull latest Git commit and restart bot)
    .addSubcommand((sub) =>
      sub
        .setName('git-sync')
        .setDescription('Pull latest Git commit and gracefully reboot/restart the server (Owner Only)')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const issuingOfficer = {
      discordId: interaction.user.id,
      discordTag: interaction.user.tag,
    };

    // If opening interactive application modal form, do NOT defer immediately (modals require virgin interaction)
    const isModalOpen = (sub === 'generate' || sub === 'apply') && !interaction.options.getString('fullname');

    if (!isModalOpen) {
      const isEphemeral = sub === 'view-template' || sub === 'import' || sub === 'export' || sub === 'memory' || sub === 'git-status';
      await safeDeferReply(interaction, { ephemeral: isEphemeral });
    }

    // ==========================================
    // COMMAND: /card setup (Required initial setup)
    // ==========================================
    if (sub === 'setup') {
      // Check permission: ManageGuild or Administrator
      if (
        interaction.member &&
        !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        return safeEditReply(interaction, {
          content: '❌ **Permission Denied:** Only server administrators or members with `Manage Server` can configure the UOI Card System.',
        });
      }

      const db = loadDatabase();
      const staffChannel = interaction.options.getChannel('staff_channel');
      const deliveryChannel = interaction.options.getChannel('delivery_channel');
      const staffRole = interaction.options.getRole('staff_role');
      const verifiedRole = interaction.options.getRole('verified_role');
      const auditChannel = interaction.options.getChannel('audit_channel');
      const autoStaffRole = (!staffRole && interaction.guild) ? findBestStaffRole(interaction.guild) : null;
      const effectiveStaffRole = staffRole || autoStaffRole;
      const autoNickname = interaction.options.getBoolean('auto_nickname') ?? true;
      const bloxlinkApiKey = interaction.options.getString('bloxlink_api_key');
      const roverApiKey = interaction.options.getString('rover_api_key');
      const applicationExpiryHours = interaction.options.getInteger('application_expiry_hours') || db.guilds?.[guildId]?.applicationExpiryHours || 48;

      db.guilds = db.guilds || {};
      db.guilds[guildId] = {
        isSetup: true,
        autoConfigured: false,
        staffChannelId: staffChannel.id,
        staffChannelName: staffChannel.name,
        deliveryChannelId: deliveryChannel ? deliveryChannel.id : null,
        deliveryChannelName: deliveryChannel ? deliveryChannel.name : null,
        staffRoleId: effectiveStaffRole ? effectiveStaffRole.id : null,
        staffRoleName: effectiveStaffRole ? effectiveStaffRole.name : null,
        verifiedRoleId: verifiedRole ? verifiedRole.id : (db.guilds[guildId]?.verifiedRoleId || null),
        verifiedRoleName: verifiedRole ? verifiedRole.name : (db.guilds[guildId]?.verifiedRoleName || null),
        auditChannelId: auditChannel ? auditChannel.id : (db.guilds[guildId]?.auditChannelId || null),
        auditChannelName: auditChannel ? auditChannel.name : (db.guilds[guildId]?.auditChannelName || null),
        autoStaffRoleDetected: !staffRole && !!autoStaffRole,
        autoNickname,
        applicationExpiryHours,
        bloxlinkApiKey: bloxlinkApiKey && !bloxlinkApiKey.includes('http') && bloxlinkApiKey.trim().length >= 8 ? bloxlinkApiKey.trim() : (db.guilds[guildId]?.bloxlinkApiKey || null),
        roverApiKey: roverApiKey && !roverApiKey.includes('http') && roverApiKey.trim().length >= 8 ? roverApiKey.trim() : (db.guilds[guildId]?.roverApiKey || null),
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
            name: '⏳ Application Review Timeout',
            value: `⏱️ **${applicationExpiryHours} Hours** *(Stale requests auto-expire to prevent stuck applications)*`,
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

      return safeEditReply(interaction, { embeds: [embed] });
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

      return safeEditReply(interaction, { embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card set-template (1 template per server, supports reset)
    // ==========================================
    if (sub === 'set-template' || sub === 'reset-template') {
      await safeDeferReply(interaction, { ephemeral: false });

      const db = loadDatabase();
      const guildConfig = db.guilds?.[guildId];

      // Robust permission validation: Server Owner, Administrator, ManageGuild, or Configured Staff Role
      const isGuildOwner = interaction.guild?.ownerId === interaction.user?.id;
      const hasAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
      const hasManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      const hasStaffRole = guildConfig?.staffRoleId && interaction.member?.roles?.cache?.has(guildConfig.staffRoleId);

      if (!isGuildOwner && !hasAdmin && !hasManage && !hasStaffRole) {
        return interaction.editReply({
          content:
            '❌ **Permission Denied:** Only server administrators, the server owner, members with `Manage Server`, or members with the authorized staff role can set this server\'s official card template.',
        });
      }

      // Check if user requested template reset
      const resetRequested = sub === 'reset-template' || interaction.options.getBoolean('reset');
      if (resetRequested) {
        deleteServerTemplate(guildId);
        const embed = new EmbedBuilder()
          .setTitle('🔄 Server Template Reverted')
          .setColor(0x38bdf8)
          .setDescription(
            `Successfully removed the custom template for **${interaction.guild ? interaction.guild.name : 'this server'}**.\n\n` +
            `This server is now using the **Official Standard UOI Template**.\n` +
            `You can upload a custom template at any time with \`/card set-template\`!`
          )
          .setFooter({ text: 'Union of Indians Registry • Template Management Engine' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      const attachment = interaction.options.getAttachment('image') || interaction.attachments?.first();
      const urlInput = interaction.options.getString('url');
      const targetSource = attachment || (urlInput ? urlInput.trim() : null);

      if (!targetSource) {
        return interaction.editReply({
          content:
            '❌ **Please attach an image** or provide a direct image `url` when running `/card set-template`.\n' +
            '*(Tip: You can attach a PNG, JPG, or WebP file, or use `/card set-template reset:True` to revert to default)*',
        });
      }

      try {
        // 1. Download image bytes with automatic CDN fallbacks, User-Agent, and HTML rejection
        const { buffer: rawBuffer } = await fetchImageBytes(targetSource, 15000);

        // 2. Validate decodability and normalize to standard 1200x900 PNG
        const normalized = await processAndNormalizeTemplate(rawBuffer);

        // 3. Save single isolated template for this server and update memory
        saveServerTemplate(guildId, normalized.buffer, {
          width: normalized.width,
          height: normalized.height,
          originalWidth: normalized.originalWidth,
          originalHeight: normalized.originalHeight,
        });

        const embed = new EmbedBuilder()
          .setTitle('✅ Official Server Template Saved')
          .setColor(0x10b981)
          .setDescription(
            `Successfully saved and verified the **official template** for **${interaction.guild ? interaction.guild.name : 'this server'}**!\n\n` +
            `🔒 **Strict Single-Template Isolation:** Exactly **1 template per server**. This template is permanently isolated to this server and will not leak to other servers.\n` +
            `All future cards rendered with \`/card show\` or approved by staff will stamp directly onto this official template.`
          )
          .addFields(
            { name: 'Server', value: interaction.guild ? `${interaction.guild.name}` : `\`${guildId}\``, inline: true },
            { name: 'Resolution', value: `${normalized.width} × ${normalized.height} px *(Original: ${normalized.originalWidth}×${normalized.originalHeight})*`, inline: true },
            { name: 'Storage Slot', value: `\`templates/${guildId}.png\``, inline: true },
            {
              name: '📐 Design Blueprint & Alignment Grid',
              value:
                '• **Photo Frame:** `X=60, Y=324, W=337, H=344`\n' +
                '• **Rank Box:** `X=54, Y=687, W=348, H=46`\n' +
                '• **Citizen Details:** `X=490` (Rows at `Y=358, 446, 534, 622, 710`)\n' +
                '• **Top Serial ID:** `X=1010, Y=36`',
            }
          )
          .setFooter({ text: 'Union of Indians Registry • Template Management Engine' })
          .setTimestamp();

        const file = new AttachmentBuilder(normalized.buffer, { name: 'server-template.png' });
        embed.setImage('attachment://server-template.png');

        return interaction.editReply({ embeds: [embed], files: [file] });
      } catch (err) {
        console.error('[UOI Bot] Error setting template:', err);
        return interaction.editReply({
          content: `❌ **Failed to process template:** ${err.message}`,
        });
      }
    }

    // ==========================================
    // COMMAND: /card view-template
    // ==========================================
    if (sub === 'view-template') {
      await interaction.deferReply({ ephemeral: true });

      const resolved = await resolveTemplateImage(guildId);
      const status = getServerTemplateStatus(guildId);

      let fileBuffer = null;
      if (resolved.filePath && fs.existsSync(resolved.filePath)) {
        try { fileBuffer = fs.readFileSync(resolved.filePath); } catch (_) {}
      }

      if (!fileBuffer) {
        const def = await generateAndSaveDefaultTemplate();
        if (def && def.buffer) fileBuffer = def.buffer;
      }

      if (!fileBuffer) {
        return interaction.editReply({
          content: '⚠️ Could not locate or render template file. Use `/card set-template` to upload a template.',
        });
      }

      const dims = getImageDimensions(fileBuffer);
      const isCustom = status.hasCustomTemplate;

      const file = new AttachmentBuilder(fileBuffer, { name: 'active-template.png' });
      const embed = new EmbedBuilder()
        .setTitle(isCustom ? '🖼️ Active Custom Server Template' : '🖼️ Official Standard UOI Template')
        .setColor(isCustom ? 0x10b981 : 0x38bdf8)
        .setDescription(
          `**Template Profile for ${interaction.guild ? interaction.guild.name : 'this server'}:**\n\n` +
          `• **Status:** ${isCustom ? '🟢 **Custom Server Template Active** (1 per server policy)' : '🔵 **Default Official Template** (No custom template uploaded yet)'}\n` +
          `• **Source:** \`${resolved.source || 'Template Storage'}\`\n` +
          `• **Resolution:** **${dims.width} × ${dims.height} px**\n` +
          `• **File Size:** ${Math.round(fileBuffer.length / 1024)} KB\n\n` +
          (isCustom
            ? '*To replace this template, upload a new image with `/card set-template`. To revert to default, use `/card reset-template`.*'
            : '*To set a custom template for this server, use `/card set-template` with your template image attached!*')
        )
        .setImage('attachment://active-template.png')
        .setFooter({ text: 'Union of Indians Registry • Template Viewer' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], files: [file] });
    }


    // ==========================================
    // COMMAND: /card whois (Roblox Auto-Detection & Identity Dossier)
    // ==========================================
    if (sub === 'whois') {
      await interaction.deferReply({ ephemeral: false });
      const targetUser = interaction.options.getUser('citizen') || interaction.user;
      const manualQuery = interaction.options.getString('roblox');

      let targetMember = null;
      if (interaction.guild) {
        try {
          targetMember = await interaction.guild.members.fetch(targetUser.id);
        } catch (_) {}
      }

      const robloxData = await autoDetectRobloxUser({
        member: targetMember || interaction.member,
        user: targetUser,
        guildId,
        guildConfig,
        manualQuery,
      });

      const db = loadDatabase();
      const existingCard = db.cards[targetUser.id];

      const embed = new EmbedBuilder()
        .setTitle(`🔎 Roblox Identity Dossier: ${targetMember?.displayName || targetUser.username}`)
        .setColor(robloxData.detected ? 0x10b981 : 0xf59e0b)
        .setDescription(
          robloxData.detected
            ? `Successfully detected and verified Roblox account for <@${targetUser.id}>!`
            : `Could not automatically link a Roblox account for <@${targetUser.id}>. You can provide your Roblox username directly when generating a card.`
        )
        .addFields(
          {
            name: 'Discord Member',
            value: `<@${targetUser.id}> (\`${targetUser.tag}\`)\n*ID: ${targetUser.id}*`,
            inline: true,
          },
          {
            name: 'Roblox Username',
            value: robloxData.username
              ? `[**@${robloxData.username}**](https://www.roblox.com/users/${robloxData.userId || '1'}/profile)${robloxData.hasVerifiedBadge ? ' ☑️' : ''}`
              : '`Not Detected`',
            inline: true,
          },
          {
            name: 'Roblox Display Name',
            value: robloxData.displayName || '`N/A`',
            inline: true,
          },
          {
            name: 'Roblox User ID',
            value: robloxData.userId ? `\`${robloxData.userId}\`` : '`N/A`',
            inline: true,
          },
          {
            name: 'Detection Source',
            value: `**${robloxData.method || 'None'}**\n*(${robloxData.confidence || 'Undetected'})*`,
            inline: true,
          },
          {
            name: 'UOI Registry Status',
            value: existingCard && existingCard.status === 'ACTIVE'
              ? `🟢 **Registered Citizen** (\`${existingCard.serialId}\`)\n*Rank: ${existingCard.assignedRank}*`
              : '⚪ **Unregistered** *(Use `/card generate`)*',
            inline: true,
          }
        )
        .setFooter({ text: 'Union of Indians Registry • Automated Verification Engine' })
        .setTimestamp();

      if (robloxData.avatarUrl) {
        embed.setThumbnail(robloxData.avatarUrl);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card link (Link Roblox Profile Permanently)
    // ==========================================
    if (sub === 'link') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen') || interaction.user;
      const robloxQuery = interaction.options.getString('roblox');

      // If linking someone else, check officer permissions
      if (targetUser.id !== interaction.user.id) {
        const isOfficer =
          interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
          interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
          (guildConfig?.staffRoleId && interaction.member?.roles?.cache?.has(guildConfig.staffRoleId));

        if (!isOfficer) {
          return interaction.editReply({
            content: '❌ You can only link your own Roblox account. Only officers can link accounts for other citizens.',
            ephemeral: true,
          });
        }
      }

      const robloxData = await fetchRobloxUserData(robloxQuery);
      if (!robloxData || !robloxData.userId) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Roblox Account Not Found')
          .setColor(0xef4444)
          .setDescription(`Could not find a valid Roblox account matching **"${robloxQuery}"**. Please verify the spelling and try again.`)
          .setFooter({ text: 'Roblox Public API Verification' })
          .setTimestamp();
        return interaction.editReply({ embeds: [errorEmbed] });
      }

      const db = loadDatabase();
      db.linkedAccounts = db.linkedAccounts || {};
      db.linkedAccounts[targetUser.id] = {
        userId: robloxData.userId,
        username: robloxData.username,
        displayName: robloxData.displayName,
        avatarUrl: robloxData.avatarUrl,
        linkedAt: new Date().toISOString(),
        linkedBy: {
          id: interaction.user.id,
          tag: interaction.user.tag,
        },
      };

      // Also update active card in database if citizen already has one
      const targetCard = getGuildCard(db, guildId, targetUser.id);
      if (targetCard && targetCard.status === 'ACTIVE') {
        targetCard.robloxUsername = robloxData.username;
        targetCard.robloxUserId = robloxData.userId;
        targetCard.avatarUrl = robloxData.avatarUrl;
      }

      saveDatabase(db);

      const linkEmbed = new EmbedBuilder()
        .setTitle('✅ Roblox Account Linked Successfully!')
        .setColor(0x10b981)
        .setDescription(
          `Successfully verified and linked <@${targetUser.id}> to Roblox profile **[@${robloxData.username}](https://www.roblox.com/users/${robloxData.userId}/profile)**!`
        )
        .addFields(
          { name: 'Roblox Username', value: `@${robloxData.username}`, inline: true },
          { name: 'Roblox User ID', value: `\`${robloxData.userId}\``, inline: true },
          { name: 'Display Name', value: robloxData.displayName || robloxData.username, inline: true },
          {
            name: '✨ Next Steps',
            value:
              `• Run \`/card generate fullname:Your Name gender:Male\` without needing to type your Roblox username again.\n` +
              `• Run \`/card whois\` to view your verified Roblox identity dossier.`,
          }
        )
        .setFooter({ text: 'Union of Indians Registry • Anti-Impersonation Protection' })
        .setTimestamp();

      if (robloxData.avatarUrl) {
        linkEmbed.setThumbnail(robloxData.avatarUrl);
      }

      return interaction.editReply({ embeds: [linkEmbed] });
    }

    // ==========================================
    // COMMAND: /card unlink (Unlink Roblox Profile)
    // ==========================================
    if (sub === 'unlink') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen') || interaction.user;

      if (targetUser.id !== interaction.user.id) {
        const isOfficer =
          interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
          interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
          (guildConfig?.staffRoleId && interaction.member?.roles?.cache?.has(guildConfig.staffRoleId));

        if (!isOfficer) {
          return interaction.editReply({
            content: '❌ You can only unlink your own account. Only officers can unlink other citizens.',
            ephemeral: true,
          });
        }
      }

      const db = loadDatabase();
      if (db.linkedAccounts && db.linkedAccounts[targetUser.id]) {
        const prev = db.linkedAccounts[targetUser.id];
        delete db.linkedAccounts[targetUser.id];
        saveDatabase(db);

        const unlinkEmbed = new EmbedBuilder()
          .setTitle('🔓 Roblox Account Unlinked')
          .setColor(0xf59e0b)
          .setDescription(`Unlinked previous Roblox account **@${prev.username}** from <@${targetUser.id}>.\nYou can link a new account anytime with \`/card link\`.`)
          .setFooter({ text: 'Union of Indians Registry' })
          .setTimestamp();
        return interaction.editReply({ embeds: [unlinkEmbed] });
      }

      return interaction.editReply({
        content: `ℹ️ No custom Roblox account was linked for <@${targetUser.id}>.`,
      });
    }

    // ==========================================
    // COMMAND: /card show (Pull card from database with visual rendering)
    // ==========================================
    if (sub === 'show' || sub === 'inspect') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('citizen') || interaction.options.getUser('user') || interaction.user;
      const isSelf = targetUser.id === interaction.user.id;

      // 1. Implicitly detect server context
      const guildId = interaction.guildId;
      const serverName = interaction.guild?.name || (guildId ? `Server ${guildId}` : 'Current Server');
      const db = loadDatabase();

      // Retrieve all active cards for this citizen across all UOI servers
      const allCitizenCards = getAllGuildCards(db).filter(
        (c) => c.discordId === targetUser.id && c.status === 'ACTIVE'
      );
      const distinctGuildsWithCards = Array.from(new Set(allCitizenCards.map((c) => c.guildId).filter(Boolean)));
      const hasOtherServerCards = distinctGuildsWithCards.some((gId) => gId !== guildId);
      const isServerSpecific = hasOtherServerCards || (distinctGuildsWithCards.length > 1);

      // Look up card specifically for this server context
      const card = getGuildCard(db, guildId, targetUser.id);

      if (!card || card.status !== 'ACTIVE') {
        const isRevokedInThisServer = card?.status === 'REVOKED';

        if (hasOtherServerCards) {
          // User has citizenship in other servers, but NOT in this server!
          const otherCardsSummary = allCitizenCards.map((c) => {
            const issuer = db.guilds?.[c.guildId]?.name || (c.guildId ? `Server ${c.guildId}` : 'Union Central');
            return `• **${issuer}**: Serial \`${c.serialId}\` (${c.assignedRank})`;
          }).join('\n');

          const multiServerNotFoundEmbed = new EmbedBuilder()
            .setTitle(`🔍 No Active Card in ${serverName}`)
            .setColor(0xf59e0b)
            .setDescription(
              isSelf
                ? `**You do not have an active citizen card registered in ${serverName}.**\n\n` +
                  `🌐 **Server-Specific Citizenship Detected:**\n` +
                  `You currently hold active citizenship in other servers:\n${otherCardsSummary}\n\n` +
                  `Because cards and roles are **server-specific**, each server maintains an independent registry. ` +
                  `Run \`/card apply\` or \`/card generate\` to obtain your official credentials for **${serverName}**!`
                : `**<@${targetUser.id}> does not possess a citizen card registered in ${serverName}.**\n\n` +
                  `🌐 **Other Server Registries:**\n${otherCardsSummary}`
            )
            .addFields(
              { name: 'Server Context', value: `\`${serverName}\``, inline: true },
              { name: 'This Server Status', value: isRevokedInThisServer ? '🔴 REVOKED' : '⚪ Unregistered', inline: true },
              { name: 'Total Union Citizenships', value: `${allCitizenCards.length} server(s)`, inline: true }
            )
            .setFooter({ text: 'Union of Indians Registry • Per-Server Context Enforced' })
            .setTimestamp();

          return interaction.editReply({ embeds: [multiServerNotFoundEmbed] });
        }

        // User has no cards in any server
        const notFoundEmbed = new EmbedBuilder()
          .setTitle(`🔍 UOI Central Registry Search: ${serverName}`)
          .setColor(0xef4444)
          .setDescription(
            isSelf
              ? `No active UOI Citizen ID card found in **${serverName}** for <@${targetUser.id}>.\n\n` +
                `Submit an application using \`/card apply\` or \`/card generate\` to receive your official credentials!`
              : `<@${targetUser.id}> does not have an active citizen card on file in **${serverName}**.`
          )
          .addFields(
            { name: 'Target Citizen', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
            { name: 'Registry Status', value: isRevokedInThisServer ? '🔴 REVOKED' : '⚪ Unregistered', inline: true },
            { name: 'Issuance Protocol', value: 'An authorized officer can issue a card using `/card generate` or approve an application from `/card apply`.' }
          )
          .setFooter({ text: `Union of Indians Central Registry • ${serverName}` })
          .setTimestamp();

        return interaction.editReply({ embeds: [notFoundEmbed] });
      }

      // 2. Render card with server context & Server-Specific flag
      const themeChoice = interaction.options.getString('theme') || card.cardTheme || guildConfig?.cardTheme || 'gold';
      const effectChoice = interaction.options.getString('effect') || card.cardEffect || guildConfig?.cardEffect || 'standard';

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
          division: card.division || 'Civilian Directorate',
          clearanceLevel: card.clearanceLevel,
          issuedAt: card.issuedAt,
          isServerSpecific,
          serverName,
          theme: themeChoice,
          effect: effectChoice,
        });
        cardBuffer = renderResult.buffer;
        usedTemplate = renderResult.usedTemplate;
        templateSource = renderResult.source;
      } catch (err) {
        console.error('[UOI Bot] Error rendering stored card image:', err);
      }

      const fileName = `${card.serialId}.png`;
      const files = [];

      // Compute 2-Month Expiration & Status
      const issuedDate = card.issuedAt ? new Date(card.issuedAt) : new Date();
      const expiresDate = card.expiresAt ? new Date(card.expiresAt) : computeCardExpiration(issuedDate);
      const isExpired = Date.now() >= expiresDate.getTime() || card.status === 'EXPIRED';
      const expiresUnix = Math.floor(expiresDate.getTime() / 1000);
      const issuedUnix = Math.floor(issuedDate.getTime() / 1000);
      const daysLeft = Math.max(0, Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

      const embed = new EmbedBuilder()
        .setTitle(`🛡️ UOI Citizen ID Card: ${card.fullName}`)
        .setColor(isExpired ? 0xef4444 : 0x10b981)
        .setDescription(
          isExpired
            ? `⚠️ **CARD EXPIRED:** This credential exceeded its **2-month validity window** and has expired. Reapply with \`/card apply\` or refresh with \`/card refresh\`.`
            : `Official identity credential retrieved from registry for <@${card.discordId}>`
        )
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
          { name: 'Division', value: card.division || 'Civilian Directorate', inline: true },
          { name: 'Clearance', value: `\`${card.clearanceLevel || 'Level I'}\``, inline: true },
          {
            name: '🏷️ Credential Scope',
            value: isServerSpecific
              ? `🌐 **SERVER-SPECIFIC FLAG**\n*Scoped to **${serverName}***`
              : `🏛️ **Standard Registry**\n*${serverName}*`,
            inline: true,
          },
          {
            name: '🎨 Visual Style & Security Effect',
            value: `Theme: **${CARD_VISUAL_THEMES[themeChoice]?.name || themeChoice}**\nEffect: **${CARD_VISUAL_EFFECTS[effectChoice]?.name || effectChoice}**`,
            inline: true,
          },
          {
            name: 'Registry Status',
            value: isExpired ? '🔴 **EXPIRED (2-Month Limit)**' : '🟢 **ACTIVE & VERIFIED**',
            inline: true,
          },
          {
            name: '📅 Issued At',
            value: `<t:${issuedUnix}:d> (<t:${issuedUnix}:R>)`,
            inline: true,
          },
          {
            name: isExpired ? '⚠️ Expired On' : '⏳ 2-Month Expiry',
            value: isExpired
              ? `**Expired** <t:${expiresUnix}:R>\nRun \`/card refresh\` or \`/card apply\` to renew`
              : `<t:${expiresUnix}:f>\n*(**${daysLeft} days remaining** • <t:${expiresUnix}:R>)*`,
            inline: false,
          }
        );

      if (hasOtherServerCards) {
        embed.addFields({
          name: '🌍 Multi-Server Citizenships',
          value: `Member holds **${allCitizenCards.length}** distinct server-specific cards across UOI communities. ` +
                 `Ranks, roles, and card designs are strictly isolated per server.`,
          inline: false,
        });
      }

      embed.setFooter({
        text: isServerSpecific
          ? `Server-Specific Credential • ${serverName} • Verified Context`
          : `Central Database Record • ${serverName} • Union of Indians`,
      }).setTimestamp();

      if (cardBuffer) {
        const attachment = new AttachmentBuilder(cardBuffer, { name: fileName });
        files.push(attachment);
        embed.setImage(`attachment://${fileName}`);
      }

      return interaction.editReply({ embeds: [embed], files });
    }

    // ==========================================
    // COMMAND 1: /card generate (Unified: Routes to staff review or opens interactive modal)
    // ==========================================
    if (sub === 'generate' || sub === 'apply') {
      const fullName = interaction.options.getString('fullname');

      // If fullname wasn't provided, open the interactive modal application!
      if (!fullName) {
        const modal = new ModalBuilder()
          .setCustomId('card_modal_apply')
          .setTitle('UOI Citizen Card Application');

        const nameInput = new TextInputBuilder()
          .setCustomId('fullName')
          .setLabel('Full Legal Name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Suresh Kumar')
          .setMinLength(2)
          .setMaxLength(36)
          .setRequired(true);

        const genderInput = new TextInputBuilder()
          .setCustomId('gender')
          .setLabel('Gender')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Male / Female / Other')
          .setMaxLength(20)
          .setRequired(true);

        const robloxInput = new TextInputBuilder()
          .setCustomId('roblox')
          .setLabel('Roblox Username (Optional - auto-detects)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Leave blank to auto-detect from linked profile')
          .setRequired(false);

        const divisionInput = new TextInputBuilder()
          .setCustomId('division')
          .setLabel('Division / Department (Optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Civilian Directorate / Armed Forces / Homeland Security')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(genderInput),
          new ActionRowBuilder().addComponents(robloxInput),
          new ActionRowBuilder().addComponents(divisionInput)
        );

        try {
          return await interaction.showModal(modal);
        } catch (modalErr) {
          console.warn('[UOI Bot] Notice showing modal:', modalErr.message);
          return null;
        }
      }

      await safeDeferReply(interaction, { ephemeral: false });

      const targetUser = interaction.options.getUser('citizen') || interaction.user;
      const robloxQuery = interaction.options.getString('roblox');
      const gender = interaction.options.getString('gender') || 'Unspecified';
      const division = interaction.options.getString('division') || 'Civilian Directorate';

      // Target member in guild for role auto-scanning and nickname resolution
      let targetMember = null;
      if (interaction.guild) {
        try {
          targetMember = await interaction.guild.members.fetch(targetUser.id);
        } catch (_) {}
      }

      // Automatically scan Discord server roles to determine genuine rank (no manual role typing or falsification)
      const scannedRankInfo = resolveCitizenRankFromRoles(targetMember || interaction.member);
      const assignedRank = scannedRankInfo.rankName;

      // STRICT RULE 1: Only 1 card per person!
      const db = loadDatabase();
      const existingCard = getGuildCard(db, guildId, targetUser.id);
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
        (r) => r.status === 'PENDING' && r.guildId === guildId && r.targetUser?.id === targetUser.id
      );
      if (existingPending) {
        if (isApplicationExpired(existingPending, guildConfig)) {
          existingPending.status = 'EXPIRED';
          existingPending.expiredAt = new Date().toISOString();
          saveDatabase(db);
          console.log(`[UOI Bot] ⏰ Auto-expired stale pending request ${existingPending.id} for <@${targetUser.id}> on re-apply.`);
        } else {
          const expiresAtUnix = existingPending.expiresAtTimestamp || (existingPending.expiresAt ? Math.floor(new Date(existingPending.expiresAt).getTime() / 1000) : null);
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
              { name: 'Status', value: '🟡 Awaiting Officer Approval', inline: true },
              ...(expiresAtUnix ? [{ name: '⏳ Expiry Countdown', value: `<t:${expiresAtUnix}:R> (<t:${expiresAtUnix}:f>)`, inline: true }] : [])
            )
            .setFooter({ text: 'Union of Indians Staff Review Queue' })
            .setTimestamp();
          return interaction.editReply({ embeds: [embed] });
        }
      }

// targetMember already resolved and roles auto-scanned above

      // Auto-Detect or Verify Roblox Account
      const robloxInfo = await autoDetectRobloxUser({
        member: targetMember || interaction.member,
        user: targetUser,
        guildId,
        guildConfig,
        manualQuery: robloxQuery,
      });

      if (!robloxInfo || !robloxInfo.detected || !robloxInfo.userId) {
        const failedEmbed = new EmbedBuilder()
          .setTitle('🔍 Roblox Account Verification Required')
          .setColor(0xf59e0b)
          .setDescription(
            robloxQuery
              ? `Could not find a valid Roblox account matching **"${robloxQuery}"**.\nPlease check the username spelling and try again!`
              : `Could not automatically detect a verified Roblox account for **<@${targetUser.id}>**.\n\n` +
                `To ensure the correct Roblox avatar and identity appear on your card (and prevent using anyone else's account), please supply your exact Roblox username:\n\n` +
                `👉 **Re-run the command with \`roblox\`:**\n` +
                `\`\`\`\n/card generate fullname:${fullName} gender:${gender} roblox:YourRobloxUsername\n\`\`\`\n` +
                `💡 **Pro-Tip:** Run \`/card link roblox:YourRobloxUsername\` once, and the bot will remember your Roblox account permanently!`
          )
          .setFooter({ text: 'Union of Indians Registry • Anti-Impersonation Protection' })
          .setTimestamp();
        return interaction.editReply({ embeds: [failedEmbed] });
      }

      // Automatically remember/link verified Roblox account for future commands
      if (robloxInfo.userId) {
        db.linkedAccounts = db.linkedAccounts || {};
        db.linkedAccounts[targetUser.id] = {
          userId: robloxInfo.userId,
          username: robloxInfo.username,
          displayName: robloxInfo.displayName,
          avatarUrl: robloxInfo.avatarUrl,
          linkedAt: new Date().toISOString(),
        };
      }

      const requestId = `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Calculate application expiration window (e.g. 48 hours)
      const appExpiryMs = getApplicationExpiryMs(guildConfig);
      const appExpiresAtDate = new Date(Date.now() + appExpiryMs);
      const appExpiresAt = appExpiresAtDate.toISOString();
      const appExpiresAtTimestamp = Math.floor(appExpiresAtDate.getTime() / 1000);

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
        division,
        clearanceLevel: computeClearanceLevel(assignedRank, division),
        scannedRoleId: scannedRankInfo.roleId,
        scannedRoleName: scannedRankInfo.roleName,
        scannedRolesCount: scannedRankInfo.scannedRolesCount,
        robloxUsername: robloxInfo.username,
        robloxUserId: robloxInfo.userId,
        robloxAvatarUrl: robloxInfo.avatarUrl,
        robloxDetectionMethod: robloxInfo.method,
        robloxDetectionConfidence: robloxInfo.confidence,
        robloxHasVerifiedBadge: robloxInfo.hasVerifiedBadge,
        submittedAt: new Date().toISOString(),
        expiresAt: appExpiresAt,
        expiresAtTimestamp: appExpiresAtTimestamp,
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
              {
                name: '🎖️ Auto-Scanned Role',
                value: scannedRankInfo.roleId
                  ? `<@&${scannedRankInfo.roleId}> (\`${assignedRank}\`)`
                  : `\`${assignedRank}\``,
                inline: true,
              },
              {
                name: 'Roblox Identity',
                value: robloxInfo.userId
                  ? `[**@${robloxInfo.username}**](https://www.roblox.com/users/${robloxInfo.userId}/profile) (\`ID: ${robloxInfo.userId}\`)${robloxInfo.hasVerifiedBadge ? ' ☑️' : ''}`
                  : `@${robloxInfo.username}`,
                inline: true,
              },
              {
                name: '🤖 Detection Source',
                value: `**${robloxInfo.method || 'Manual'}**\n*(${robloxInfo.confidence || 'Verified'})*`,
                inline: true,
              },
              { name: 'Request ID', value: `\`${requestId}\``, inline: true },
              { name: 'Submitted At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
              { name: '⏳ Application Expiry', value: `<t:${appExpiresAtTimestamp}:R> (<t:${appExpiresAtTimestamp}:f>)`, inline: true }
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
          `🤖 **Roblox Auto-Detection:** Linked to [**@${robloxInfo.username}**](https://www.roblox.com/users/${robloxInfo.userId || '1'}/profile)${robloxInfo.hasVerifiedBadge ? ' ☑️' : ''} via **${robloxInfo.method}**.\n\n` +
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
          {
            name: '🎖️ Auto-Scanned Server Role',
            value: scannedRankInfo.roleId
              ? `<@&${scannedRankInfo.roleId}> (\`${assignedRank}\`)`
              : `\`${assignedRank}\``,
            inline: true,
          },
          {
            name: 'Staff Review Channel',
            value: `<#${guildConfig.staffChannelId}>`,
            inline: true,
          },
          {
            name: '⏳ Review Timeout Window',
            value: `<t:${appExpiresAtTimestamp}:R> (Expires if unreviewed)`,
            inline: true,
          },
          {
            name: '⏱️ What happens next?',
            value:
              '• Union officers will inspect your Roblox account and information in staff chat.\n' +
              '• When **Accepted**, your official card is rendered, delivered, and your nickname updated.\n' +
              '• If **Declined**, staff will provide a specific reason and you will receive a notification.\n' +
              '• If left unreviewed, the request auto-expires after the timeout window so you are never stuck!',
          }
        )
        .setFooter({ text: 'Union of Indians Central Registry • Verification Queue' })
        .setTimestamp();

      if (robloxInfo.avatarUrl) {
        applicantEmbed.setThumbnail(robloxInfo.avatarUrl);
      }

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

    // ==========================================
    // COMMAND: /card refresh (Citizen Self-Service Avatar & Role Sync)
    // ==========================================
    if (sub === 'refresh') {
      await interaction.deferReply({ ephemeral: false });
      const db = loadDatabase();
      const card = getGuildCard(db, guildId, interaction.user.id) || db.cards[interaction.user.id];
      if (!card || card.status !== 'ACTIVE') {
        return interaction.editReply({
          content: '❌ **No Active Card Found:** You do not have an active UOI Citizen Card registered to your Discord account in this server.\nUse `/card apply` or `/card generate` to apply for one!',
        });
      }

      // Re-scan current member roles in server
      let member = interaction.member;
      if (interaction.guild) {
        try { member = await interaction.guild.members.fetch(interaction.user.id); } catch (_) {}
      }
      const scannedRankInfo = resolveCitizenRankFromRoles(member);
      const newRank = scannedRankInfo.rankName;

      // Re-detect latest Roblox avatar & headshot
      const robloxInfo = await autoDetectRobloxUser({
        member,
        user: interaction.user,
        guildId,
        guildConfig,
        manualQuery: card.robloxUsername || card.robloxUserId,
      });

      card.assignedRank = newRank;
      if (robloxInfo?.avatarUrl) card.avatarUrl = robloxInfo.avatarUrl;
      if (robloxInfo?.username) card.robloxUsername = robloxInfo.username;
      card.lastRefreshedAt = new Date().toISOString();
      setGuildCard(db, guildId, interaction.user.id, card);
      saveDatabase(db);

      const renderResult = await renderCardImage({
        guildId,
        fullName: card.fullName,
        robloxUsername: card.robloxUsername,
        robloxUserId: card.robloxUserId,
        gender: card.gender,
        assignedRank: card.assignedRank,
        serialId: card.serialId,
        avatarUrl: card.avatarUrl,
        division: card.division,
        clearanceLevel: card.clearanceLevel,
        issuedAt: card.issuedAt,
      });

      const files = [];
      if (renderResult.buffer) {
        files.push(new AttachmentBuilder(renderResult.buffer, { name: `${card.serialId}.png` }));
      }

      const embed = new EmbedBuilder()
        .setTitle('🔄 UOI Citizen Card Refreshed')
        .setColor(0x10b981)
        .setDescription(`**Your citizen card has been updated with your latest Roblox avatar & Discord server role!**\nYour registered Serial ID \`${card.serialId}\` remains permanent.`)
        .addFields(
          { name: 'Full Name', value: card.fullName, inline: true },
          { name: 'Updated Role / Rank', value: `**${card.assignedRank}**`, inline: true },
          { name: 'Roblox Username', value: `@${card.robloxUsername || 'N/A'}`, inline: true },
          { name: 'Serial ID', value: `\`${card.serialId}\``, inline: true },
          { name: 'Status', value: '🟢 ACTIVE CITIZEN', inline: true },
        )
        .setFooter({ text: 'Union of Indians Registry • Instant Card Synchronizer' })
        .setTimestamp();

      if (card.avatarUrl) embed.setThumbnail(card.avatarUrl);

      dispatchAuditLog(interaction.guild, guildConfig, {
        event: 'CARD_REFRESHED',
        citizenUser: interaction.user,
        officerUser: interaction.user,
        serialId: card.serialId,
        reason: 'Citizen self-service avatar & role synchronization',
      });

      return interaction.editReply({ embeds: [embed], files });
    }

    // ==========================================
    // COMMAND: /card export (Download Card Files - Owner & Admin Only)
    // ==========================================
    if (sub === 'export') {
      await interaction.deferReply({ ephemeral: true });
      const hasPerm = await checkIsOwnerOrAdmin(interaction);
      if (!hasPerm) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Downloading and exporting card files is strictly restricted to the **Server Owner** or members with the **Administrator** permission.',
        });
      }

      const format = interaction.options.getString('format') || 'json';
      const scope = interaction.options.getString('scope') || 'this_server';
      const db = loadDatabase();
      const allCards = getAllGuildCards(db);

      const targetCards = scope === 'all_servers'
        ? allCards
        : (guildId ? allCards.filter((c) => c.guildId === guildId || !c.guildId) : allCards);

      if (targetCards.length === 0) {
        return interaction.editReply({
          content: `📋 **No Citizen Cards Found:** No active card records are currently registered for ${scope === 'all_servers' ? 'the entire network' : 'this server'}.`,
        });
      }

      // Ensure every card has marked date, time, 2-month expiry, and days remaining
      const now = Date.now();
      const enrichedCards = targetCards.map((c) => {
        const { card } = stampCardTimestamps({ ...c });
        const expTime = new Date(card.expiresAt).getTime();
        const daysRemaining = Math.max(0, Math.ceil((expTime - now) / (1000 * 60 * 60 * 24)));
        return {
          ...card,
          daysRemaining,
          isExpired: now >= expTime,
        };
      });

      let fileBuffer = null;
      let fileName = '';
      const dateTag = new Date().toISOString().slice(0, 10);

      if (format === 'json') {
        const payload = {
          exportType: 'UOI_CITIZEN_REGISTRY_DUMP',
          exportedAt: new Date().toISOString(),
          exportedAtFormatted: formatCardDateTime(new Date()),
          exportedBy: {
            discordId: interaction.user.id,
            discordTag: interaction.user.tag,
          },
          server: {
            guildId: guildId || 'global',
            name: interaction.guild?.name || 'Central Registry',
          },
          scope,
          totalCards: enrichedCards.length,
          validityPolicy: '2 Months Standard Expiration',
          cards: enrichedCards,
        };
        fileBuffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
        fileName = `uoi_cards_${guildId || 'registry'}_${dateTag}.json`;
      } else {
        const headers = [
          'Serial ID',
          'Full Name',
          'Gender',
          'Roblox Username',
          'Roblox UID',
          'Rank',
          'Division',
          'Clearance',
          'Status',
          'Issued Date (ISO)',
          'Issued Date (Formatted)',
          'Expires Date (ISO)',
          'Expires Date (Formatted)',
          'Days Remaining',
          'Discord ID',
          'Guild ID',
        ];
        const csvRows = [headers.join(',')];
        for (const c of enrichedCards) {
          const row = [
            `"${c.serialId || ''}"`,
            `"${(c.fullName || '').replace(/"/g, '""')}"`,
            `"${c.gender || ''}"`,
            `"${c.robloxUsername || ''}"`,
            `"${c.robloxUserId || ''}"`,
            `"${c.assignedRank || ''}"`,
            `"${c.division || 'Civilian Directorate'}"`,
            `"${c.clearanceLevel || 'Level I'}"`,
            `"${c.status || 'ACTIVE'}"`,
            `"${c.issuedAt || ''}"`,
            `"${c.issuedAtFormatted || ''}"`,
            `"${c.expiresAt || ''}"`,
            `"${c.expiresAtFormatted || ''}"`,
            `"${c.daysRemaining !== undefined ? c.daysRemaining : ''}"`,
            `"${c.discordId || ''}"`,
            `"${c.guildId || ''}"`,
          ];
          csvRows.push(row.join(','));
        }
        fileBuffer = Buffer.from(csvRows.join('\n'), 'utf8');
        fileName = `uoi_cards_${guildId || 'registry'}_${dateTag}.csv`;
      }

      // Save an immutable permanent snapshot to data/backups/
      const backupSnapshotName = savePermanentSnapshot('export', fileName, fileBuffer);

      const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });
      const exportEmbed = new EmbedBuilder()
        .setTitle('📥 UOI Citizen Cards Download')
        .setColor(0x10b981)
        .setDescription(
          `Successfully generated and archived **${enrichedCards.length}** citizen card record(s) in **${format.toUpperCase()}** format.\n\n` +
          `🔒 **Permanent Storage Onwards:** Every card is stamped with complete date & time of creation, exact 2-month expiration date, and archived permanently in the central registry.`
        )
        .addFields(
          { name: 'Total Exported', value: `\`${enrichedCards.length}\` citizens`, inline: true },
          { name: 'File Format', value: format.toUpperCase(), inline: true },
          { name: 'Scope', value: scope === 'all_servers' ? '🌐 Network-Wide' : `🏛️ ${interaction.guild?.name || 'This Server'}`, inline: true },
          { name: 'Validity Stamped', value: '⏳ **2 Months** per card', inline: true },
          { name: 'Archival Backup', value: `\`data/backups/${backupSnapshotName || 'snapshot.json'}\``, inline: true },
          { name: 'Authorized By', value: `<@${interaction.user.id}> *(Owner/Admin)*`, inline: true }
        )
        .setFooter({ text: 'Union of Indians Registry • Permanent Storage & Export' })
        .setTimestamp();

      return interaction.editReply({ embeds: [exportEmbed], files: [attachment] });
    }

    // ==========================================
    // COMMAND: /card import (Upload Card Files - Multiple Files & Unmarked Format Support)
    // ==========================================
    if (sub === 'import') {
      await interaction.deferReply({ ephemeral: true });
      const hasPerm = await checkIsOwnerOrAdmin(interaction);
      if (!hasPerm) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Uploading and importing card files is strictly restricted to the **Server Owner** or members with the **Administrator** permission.',
        });
      }

      const mode = interaction.options.getString('mode') || 'merge';
      const fileOptions = ['file', 'file2', 'file3', 'file4', 'file5'];
      const attachedFiles = fileOptions
        .map((optName) => interaction.options.getAttachment(optName))
        .filter(Boolean);

      if (attachedFiles.length === 0) {
        return interaction.editReply({
          content: '❌ **No File Attached:** Please attach at least one valid `.json` or `.csv` card file to import.',
        });
      }

      const db = loadDatabase();
      if (mode === 'replace' && guildId) {
        // Clear existing cards for this server
        if (db.serverCards && db.serverCards[guildId]) {
          db.serverCards[guildId] = {};
        }
        if (db.cards && typeof db.cards === 'object') {
          for (const key of Object.keys(db.cards)) {
            if (key.startsWith(`${guildId}_`)) {
              delete db.cards[key];
            }
          }
        }
      }

      let totalCardsProcessed = 0;
      let unmarkedStampedCount = 0;
      let markedPreservedCount = 0;
      const fileReport = [];
      const errorReport = [];

      for (const attachment of attachedFiles) {
        let fileBuffer = null;
        try {
          const res = await fetch(attachment.url);
          if (!res.ok) throw new Error(`HTTP status ${res.status}`);
          const arrayBuf = await res.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuf);
        } catch (fetchErr) {
          errorReport.push(`Failed to download \`${attachment.name}\`: ${fetchErr.message}`);
          continue;
        }

        // Save raw uploaded file to permanent backup storage
        savePermanentSnapshot('import', `${guildId || 'server'}_${attachment.name}`, fileBuffer);

        // Parse card file
        const parsedResult = parseCardFile(fileBuffer, attachment.name);
        if (parsedResult.error || !parsedResult.cards || parsedResult.cards.length === 0) {
          errorReport.push(`Could not parse \`${attachment.name}\`: ${parsedResult.error || 'No valid card records found'}`);
          continue;
        }

        let fileCardsCount = 0;
        let fileUnmarkedCount = 0;

        for (const rawCard of parsedResult.cards) {
          if (!rawCard || typeof rawCard !== 'object') continue;

          // Target Discord User ID
          const targetUserId = (rawCard.discordId || '').trim() ||
            `imported_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

          // Stamp date/time and 2-month expiry (handles marked vs unmarked format seamlessly)
          const { card: stampedCard, wasUnmarked } = stampCardTimestamps(rawCard);
          if (wasUnmarked) {
            unmarkedStampedCount++;
            fileUnmarkedCount++;
          } else {
            markedPreservedCount++;
          }

          // Ensure valid serial ID
          if (!stampedCard.serialId) {
            stampedCard.serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
          }

          // Ensure server nickname and division
          stampedCard.guildId = guildId || stampedCard.guildId || null;
          stampedCard.fullName = stampedCard.fullName || 'Citizen';
          stampedCard.assignedRank = (stampedCard.assignedRank || 'CITIZEN').toUpperCase();
          stampedCard.division = stampedCard.division || 'Civilian Directorate';
          stampedCard.clearanceLevel = stampedCard.clearanceLevel || computeClearanceLevel(stampedCard.assignedRank, stampedCard.division);
          stampedCard.serverNickname = stampedCard.serverNickname || `${stampedCard.fullName} [${stampedCard.serialId}]`;
          stampedCard.importedAt = new Date().toISOString();
          stampedCard.importedBy = {
            discordId: interaction.user.id,
            discordTag: interaction.user.tag,
          };

          setGuildCard(db, guildId, targetUserId, stampedCard);
          fileCardsCount++;
          totalCardsProcessed++;
        }

        fileReport.push(`• **${attachment.name}**: \`${fileCardsCount}\` cards (${fileUnmarkedCount} auto-stamped from unmarked format)`);
      }

      // Save to permanent cards database and flush synchronously
      saveDatabase(db);
      flushCardsDbSync();

      const importEmbed = new EmbedBuilder()
        .setTitle('📤 UOI Card Files Upload & Import Complete')
        .setColor(totalCardsProcessed > 0 ? 0x10b981 : 0xef4444)
        .setDescription(
          totalCardsProcessed > 0
            ? `Successfully uploaded and permanently stored **${totalCardsProcessed}** card(s) across **${attachedFiles.length}** file(s)!\n\n` +
              `📁 **Permanent Storage Onwards:** All cards are written to \`data/cards.json\` and archived in \`data/backups/\`.\n` +
              `⏳ **2-Month Expiration & Sentinel:** All imported cards have active 2-month validity windows with proactive automated DM alerts at 10, 5, 3, and 1 days prior.`
            : `⚠️ **No cards imported:** No valid citizen card records could be extracted from the uploaded file(s).`
        )
        .addFields(
          { name: 'Total Cards Stored', value: `\`${totalCardsProcessed}\` cards`, inline: true },
          { name: 'Files Uploaded', value: `\`${attachedFiles.length}\` file(s)`, inline: true },
          { name: 'Import Mode', value: mode === 'replace' ? '⚠️ Replace Server' : '🔄 Merge / Update', inline: true },
          {
            name: '⏱️ Date & Time Stamping',
            value:
              `• **Unmarked Format Stamped:** \`${unmarkedStampedCount}\` cards *(Auto-stamped with creation date/time and 2-month expiry)*\n` +
              `• **Marked Cards Preserved:** \`${markedPreservedCount}\` cards *(Retained original dates)*`,
            inline: false,
          },
          {
            name: '📄 Processed File Details',
            value: fileReport.length > 0 ? fileReport.join('\n') : '*None*',
            inline: false,
          }
        );

      if (errorReport.length > 0) {
        importEmbed.addFields({
          name: '⚠️ Notices / Warnings',
          value: errorReport.join('\n').slice(0, 1024),
          inline: false,
        });
      }

      importEmbed.setFooter({ text: 'Union of Indians Central Registry • Multi-File Importer' }).setTimestamp();

      return interaction.editReply({ embeds: [importEmbed] });
    }

    if (sub === 'verify') {
      const serial = interaction.options.getString('serial').toUpperCase();
      const db = loadDatabase();
      const card = resolveCardBySerial(db, serial);

      if (!card) {
        const embed = new EmbedBuilder()
          .setTitle(`Citizen Card Verification: ${serial}`)
          .setColor(0xef4444)
          .setDescription(`❌ **UNVERIFIED OR FRAUDULENT SERIAL ID**\nSerial \`${serial}\` was not found in the official UOI database.`)
          .setTimestamp();
        return safeEditReply(interaction, { embeds: [embed] });
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
      return safeEditReply(interaction, { embeds: [embed] });
    }


    // ==========================================
    // COMMAND: /card promote (Staff & Admins)
    // ==========================================
    if (sub === 'promote') {
      const db = loadDatabase();
      const hasPerm = await checkIsStaffOrAdmin(interaction, db.guilds?.[guildId]);
      if (!hasPerm) {
        return safeEditReply(interaction, {
          content: '❌ **Permission Denied:** Only authorized officers, administrators, or the server owner can promote citizens.',
        });
      }
      const targetUser = interaction.options.getUser('citizen');
      const newRank = interaction.options.getString('rank').toUpperCase();
      const reason = interaction.options.getString('reason') || 'Commendable service to the Union';

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
      return safeEditReply(interaction, { embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card revoke (Security & Admins)
    // ==========================================
    if (sub === 'revoke') {
      const db = loadDatabase();
      const hasPerm = await checkIsStaffOrAdmin(interaction, db.guilds?.[guildId]);
      if (!hasPerm) {
        return safeEditReply(interaction, {
          content: '❌ **Permission Denied:** Only authorized security officers, administrators, or the server owner can revoke citizen cards.',
        });
      }
      const serial = interaction.options.getString('serial').toUpperCase();
      const reason = interaction.options.getString('reason');

      const card = resolveCardBySerial(db, serial);
      if (!card) {
        return safeEditReply(interaction, {
          content: `❌ Card with Serial ID \`${serial}\` was not found in the registry.`,
        });
      }

      // Ensure officers can only revoke cards issued within their own server
      if (guildId && card.guildId && card.guildId !== guildId) {
        const issuerName = db.guilds?.[card.guildId]?.name || `Server ${card.guildId}`;
        return safeEditReply(interaction, {
          content: `❌ **Permission Denied:** Serial \`${serial}\` was issued by another server (**${issuerName}**).\nYou can only revoke cards issued within **${interaction.guild?.name || 'this server'}**!`,
        });
      }

      card.status = 'REVOKED';
      card.revokedAt = new Date().toISOString();
      card.revokeReason = reason;
      saveDatabase(db);

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
      return safeEditReply(interaction, { embeds: [embed] });
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
      const colorChoice = interaction.options.getString('color') ?? 'tiranga';
      const customHex1 = interaction.options.getString('custom_hex');
      const customHex2 = interaction.options.getString('custom_hex2');

      const resolvedColor = resolveBotStyleColors(colorChoice, customHex1, customHex2);
      const colors = resolvedColor.colors;

      const token = (process.env.DISCORD_TOKEN || '').trim();
      if (!token) {
        return interaction.editReply({
          content: '❌ **Bot Token Missing:** DISCORD_TOKEN is not configured.',
        });
      }

      const rest = new REST({ version: '10' }).setToken(token);

      try {
        const db = loadDatabase();
        db.guilds = db.guilds || {};
        db.guilds[guildId] = db.guilds[guildId] || {};

        if (reset) {
          // Reset Discord member display name styling
          try {
            await rest.patch(`/guilds/${guildId}/members/@me`, {
              body: {
                display_name_font_id: null,
                display_name_effect_id: null,
                display_name_colors: null,
              },
            });
          } catch (_) {}

          // Reset bot role color
          let roleReset = false;
          try {
            const botMember = interaction.guild?.members?.me || await interaction.guild?.members?.fetch(interaction.client.user.id);
            if (botMember) {
              const roleToReset = botMember.roles.cache
                .filter((r) => r.editable && r.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .first();
              if (roleToReset) {
                await roleToReset.setColor(0);
                roleReset = true;
              }
            }
          } catch (_) {}

          delete db.guilds[guildId].botStyle;
          saveDatabase(db);
          flushCardsDbSync();

          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle('🔄 Bot Display Name Style Reset')
                .setColor(0x94a3b8)
                .setDescription('The bot display name and role color have been reverted to normal standard Discord styling.')
                .addFields(
                  { name: 'Role Color Reset', value: roleReset ? '✅ Reverted to default @everyone color' : 'ℹ️ Standard default', inline: true }
                )
                .setFooter({ text: 'Union of Indians Visual Engine • Style Cleared' })
                .setTimestamp(),
            ],
          });
        }

        // Apply style to guild through unified helper
        const applyResult = await applyBotStyleToGuild(
          interaction.guild,
          rest,
          { fontId, effectId, colors },
          interaction.client.user
        );

        // Save server preference to database so it persists across reboots
        db.guilds[guildId].botStyle = {
          fontId,
          effectId,
          colorChoice: resolvedColor.themeKey,
          themeName: resolvedColor.themeName,
          colors: resolvedColor.colors,
          hex: resolvedColor.hex,
          primaryHex: resolvedColor.primaryHex,
          isCustom: resolvedColor.isCustom,
          appliedAt: new Date().toISOString(),
        };
        saveDatabase(db);
        flushCardsDbSync();

        const fontNames = {
          10: 'Font 10: Sinistre (Vampyre / Gothic) 🧛 [Requested]',
          8: 'Font 8: Pixelify Sans (8-Bit Arcade) 👾',
          3: 'Font 3: Cherry Bomb (Sakura) 🌸',
          4: 'Font 4: Chicle (Jellybean) 🍬',
          6: 'Font 6: MuseoModerno (Modern Geometric) 🌐',
          7: 'Font 7: Neo-Castel (Medieval) ⚔️',
          11: 'Font 11: GG Sans (Discord Default) 🔄',
          12: 'Font 12: Zilla Slab (Tempo / Serif) 📜',
        };

        const activeEffectObj = BOT_STYLE_EFFECTS[effectId] || { name: `Effect ${effectId}`, emoji: '✨', description: 'Visual Discord effect' };

        const embed = new EmbedBuilder()
          .setTitle('🎨 UOI Bot Name Style & Visual Effects Applied!')
          .setColor(colors[0])
          .setDescription(
            `Successfully styled <@${interaction.client.user.id}> in **${interaction.guild?.name || 'this server'}**!\n\n` +
            `✨ **Active Palette:** \`${resolvedColor.hex.join(' ➔ ')}\`\n` +
            `🎭 **Visual Effect:** ${activeEffectObj.emoji} **${activeEffectObj.name}**\n*${activeEffectObj.description}*`
          )
          .addFields(
            { name: 'Active Font', value: `\`${fontNames[fontId] || fontId}\``, inline: true },
            { name: 'Effect Preset', value: `${activeEffectObj.emoji} \`${activeEffectObj.name}\``, inline: true },
            { name: 'Color Theme', value: `**${resolvedColor.themeName}**\n\`${resolvedColor.hex.join(' ➔ ')}\``, inline: true },
            {
              name: '🏷️ Role Color (Chat & Member List)',
              value: applyResult.roleUpdated
                ? `✅ **Updated <@&${applyResult.roleName}>** to \`${resolvedColor.primaryHex}\`\n*(Guaranteed high-visibility color in chat, sidebar, and profile popups for all users!)*`
                : `ℹ️ Ensure the bot has a role above @everyone with \`Manage Roles\` permission so it can automatically color its sidebar name.`,
              inline: false,
            },
            {
              name: '📱 Discord Display Name Styling Note',
              value: applyResult.restPatched
                ? `✅ Custom font (\`${fontNames[fontId] || fontId}\`) and two-tone gradient properties registered with Discord API.`
                : `ℹ️ Discord's native font/effect rendering requires client/Nitro compatibility. The server **Role Color** above provides guaranteed color in chat and member list!`,
              inline: false,
            },
            {
              name: '💾 Permanent Storage',
              value: `✅ Saved to permanent server settings. This style will automatically re-apply on bot reboots and redeployments!`,
              inline: false,
            }
          )
          .setFooter({ text: 'Union of Indians Registry • Visual Branding Engine' })
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
    // COMMAND: /card memory (Inspect permanent memory & server setups) [Owner Only]
    // ==========================================
    if (sub === 'memory') {
      await interaction.deferReply({ ephemeral: true });
      const isOwner = await checkIsOwner(interaction);
      if (!isOwner) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Server memory and persistent storage diagnostics are restricted to the **Server Owner / Bot Owner** only.',
        });
      }

      const allServers = getAllServerRecords();
      const currentServerRecord = getServerRecord(guildId) || (interaction.guild ? recordServer(interaction.guild) : null);
      const db = loadDatabase();
      const guildSetup = db.guilds?.[guildId] || currentServerRecord?.setup;

      const configuredCount = allServers.filter((s) => s.setup?.isSetup).length;
      const autoCount = allServers.filter((s) => s.setup?.autoConfigured).length;
      const totalCards = getAllGuildCards(db).length;
      const guildCardsCount = getAllGuildCards(db, guildId).length;

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

    // ==========================================
    // COMMAND: /card git-status (Inspect Git & Auto-Deploy Pipeline) [Owner Only]
    // ==========================================
    if (sub === 'git-status') {
      await interaction.deferReply({ ephemeral: true });
      const isOwner = await checkIsOwner(interaction);
      if (!isOwner) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Git deployment pipeline status and repository diagnostics are restricted to the **Server Owner / Bot Owner** only.',
        });
      }

      const git = getGitStatus();
      const embed = new EmbedBuilder()
        .setTitle('🚀 Git Auto-Sync & Auto-Restart Status')
        .setColor(0x38bdf8)
        .setDescription(
          `**Automatic Server Restart on Git Commit is ACTIVE.**\n` +
          `Whenever a new commit is pushed to the repository or detected via GitHub Webhooks, the bot pulls the latest code and gracefully reboots without dropping data.`
        )
        .addFields(
          {
            name: '📦 Active Commit',
            value: `• **Hash:** \`${git.shortHash || 'N/A'}\` (\`${git.commitHash || 'latest'}\`)\n` +
                   `• **Branch:** \`${git.branch || 'main'}\`\n` +
                   `• **Author:** \`${git.commitAuthor || 'GitHub'}\`\n` +
                   `• **Message:** *${(git.commitMessage || 'Latest build').split('\n')[0]}*\n` +
                   `• **Date:** ${git.commitDate ? new Date(git.commitDate).toLocaleString() : 'Recent'}`,
            inline: false,
          },
          {
            name: '⚡ Webhook Endpoint',
            value: `\`POST /api/webhook/github\`\n*Set Payload URL to this server's endpoint in GitHub Repo -> Settings -> Webhooks.*`,
            inline: true,
          },
          {
            name: '🔄 Auto-Restart Mode',
            value: `• **Status:** 🟢 **Active**\n• **Polling:** \`${git.pollIntervalSeconds}s\`\n• **Auto-Pull:** \`${git.autoPullEnabled ? 'Enabled' : 'Disabled'}\``,
            inline: true,
          }
        )
        .setFooter({ text: 'Union of Indians Registry • Git Auto-Sync Engine' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // COMMAND: /card git-sync (Pull latest commit & restart)
    // ==========================================
    if (sub === 'git-sync') {
      await interaction.deferReply({ ephemeral: false });

      const isAdmin =
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

      if (!isAdmin) {
        return interaction.editReply({
          content: '❌ **Permission Denied:** Only administrators can trigger manual Git synchronization and server restart.',
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔄 Initiating Git Pull & Server Restart')
        .setColor(0xf59e0b)
        .setDescription(
          `**Pulling latest commits from remote repository and rebooting server...**\n` +
          `The bot process will restart momentarily to load all updated commands, templates, and configurations.`
        )
        .setFooter({ text: 'Union of Indians Registry • Live Deployment' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      pullLatestCode().then(() => {
        gracefulRestart(`Discord Slash Command /card git-sync by @${interaction.user.tag}`);
      });
      return;
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
        return safeReply(interaction, {
          content: `❌ **Permission Denied:** You need the <@&${guildConfig.staffRoleId}> role to review citizen card applications.`,
          ephemeral: true,
        });
      }
    } else {
      const isAdmin =
        interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!isAdmin) {
        return safeReply(interaction, {
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
        return safeReply(interaction, {
          content: `❌ Card application record \`${requestId}\` not found in the database.`,
          ephemeral: true,
        });
      }

      if (req.status !== 'PENDING') {
        return safeReply(interaction, {
          content: `⚠️ This card application has already been marked as **${req.status}** by <@${req.reviewedBy?.discordId || 'Staff'}>.`,
          ephemeral: true,
        });
      }

      if (isApplicationExpired(req, guildConfig)) {
        req.status = 'EXPIRED';
        req.expiredAt = new Date().toISOString();
        saveDatabase(db);

        if (interaction.message) {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('card_expired_btn')
              .setLabel('Application Expired (48h Timeout)')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
              .setEmoji('⏰')
          );
          await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
        }

        return safeReply(interaction, {
          content: `⏰ **Application Expired:** This card request has exceeded its 48-hour review window and expired. The citizen is cleared to submit a fresh application.`,
          ephemeral: true,
        });
      }

      await safeDeferReply(interaction, { ephemeral: true });

      // Generate Serial ID & Server Nickname
      const serialId = `UOI-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const serverNickname = `${req.fullName} [${serialId}]`;

      // Calculate 2-month expiration and human-readable UTC timestamps
      const now = new Date();
      const issuedAt = now.toISOString();
      const issuedAtFormatted = formatCardDateTime(now);
      const expiresAtDate = computeCardExpiration(now);
      const expiresAt = expiresAtDate.toISOString();
      const expiresAtFormatted = formatCardDateTime(expiresAtDate);
      const expiresAtTimestamp = Math.floor(expiresAtDate.getTime() / 1000);

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
          division: req.division || 'Civilian Directorate',
          clearanceLevel: req.clearanceLevel || computeClearanceLevel(req.assignedRank, req.division),
          issuedAt,
          issuedOfficerTag: interaction.user.tag,
        });
        cardBuffer = renderResult.buffer;
        usedTemplate = renderResult.usedTemplate;
        templateSource = renderResult.source;
      } catch (err) {
        console.error('[UOI Bot] Error rendering approved card image:', err);
      }

      // Save to active card database with permanent timestamps & 2-month expiry
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
        division: req.division || 'Civilian Directorate',
        clearanceLevel: req.clearanceLevel || computeClearanceLevel(req.assignedRank, req.division),
        avatarUrl: req.robloxAvatarUrl,
        robloxDetectionMethod: req.robloxDetectionMethod || 'Manual',
        robloxDetectionConfidence: req.robloxDetectionConfidence || 'Verified',
        robloxHasVerifiedBadge: !!req.robloxHasVerifiedBadge,
        issuedBy: {
          discordId: interaction.user.id,
          discordTag: interaction.user.tag,
        },
        issuedAt,
        issuedAtFormatted,
        expiresAt,
        expiresAtFormatted,
        expiresAtTimestamp,
        remindersSent: { d10: false, d5: false, d3: false, d1: false, expired: false },
        serverNickname,
        status: 'ACTIVE',
      };
      setGuildCard(db, guildId, req.targetUser.id, newCardRecord);

      // Update pending request status
      req.status = 'APPROVED';
      req.reviewedBy = { discordId: interaction.user.id, discordTag: interaction.user.tag };
      req.reviewedAt = new Date().toISOString();
      req.issuedSerialId = serialId;
      saveDatabase(db);
      flushCardsDbSync();

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

      // 1. Automatically update server nickname if enabled
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

      // 2. Automatically assign verified citizen role if configured or auto-detected
      try {
        let roleToAssign = guildConfig?.verifiedRoleId;
        if (!roleToAssign && interaction.guild) {
          const autoRole = interaction.guild.roles.cache.find(r =>
            /citizen|verified|member/i.test(r.name) && !r.managed && r.id !== interaction.guild.id
          );
          if (autoRole) roleToAssign = autoRole.id;
        }
        if (roleToAssign && interaction.guild) {
          const member = await interaction.guild.members.fetch(req.targetUser.id);
          if (member && !member.roles.cache.has(roleToAssign)) {
            await member.roles.add(roleToAssign);
            console.log(`[UOI Bot] 🎖️ Assigned verified role <@&${roleToAssign}> to approved citizen <@${req.targetUser.id}>`);
          }
        }
      } catch (roleErr) {
        console.warn('[UOI Bot] Auto-role assignment notice:', roleErr.message);
      }

      // 3. Dispatch Security Audit Log to audit channel
      dispatchAuditLog(interaction.guild, guildConfig, {
        event: 'CARD_ISSUED',
        citizenUser: req.targetUser,
        officerUser: interaction.user,
        serialId,
        reason: 'Citizen application reviewed and approved by staff',
        fields: [
          { name: 'Full Name', value: req.fullName, inline: true },
          { name: 'Assigned Rank', value: `\`${req.assignedRank}\``, inline: true },
          { name: 'Roblox Profile', value: `@${req.robloxUsername || 'Unlinked'}`, inline: true },
        ],
      });

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
          { name: 'Assigned Nickname', value: `\`${serverNickname}\``, inline: true },
          { name: '⏳ Expiration Date', value: `<t:${expiresAtTimestamp}:D> (<t:${expiresAtTimestamp}:R>) *(2 Months)*`, inline: true }
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

      // 4. Send Direct Message (DM) to the person who was accepted
      let dmSent = false;
      try {
        let recipientUser = null;
        try {
          recipientUser = await interaction.client.users.fetch(req.targetUser.id);
        } catch (_) {
          recipientUser = interaction.guild?.members?.cache?.get(req.targetUser.id)?.user || null;
        }

        if (recipientUser) {
          const dmFiles = [];
          if (cardBuffer) {
            dmFiles.push(new AttachmentBuilder(cardBuffer, { name: fileName }));
          }

          const serverName = interaction.guild ? interaction.guild.name : 'Union of Indians';
          const dmEmbed = new EmbedBuilder()
            .setTitle('🎉 Your Citizen ID Card Has Been Approved!')
            .setColor(0x10b981)
            .setDescription(
              `Greetings **${req.fullName}**! Your citizen card application for **${serverName}** has been **APPROVED** by staff!\n\n` +
              `Your official identification credential is now registered in the database and active. Your official card is attached below.`
            )
            .addFields(
              { name: '🏛️ Server', value: serverName, inline: true },
              { name: '🆔 Serial ID', value: `\`${serialId}\``, inline: true },
              { name: '🎖️ Rank / Tier', value: `**${req.assignedRank}**`, inline: true },
              { name: '👤 Full Name', value: req.fullName, inline: true },
              {
                name: '🎮 Roblox Profile',
                value: req.robloxUserId
                  ? `[@${req.robloxUsername}](https://www.roblox.com/users/${req.robloxUserId}/profile)`
                  : `@${req.robloxUsername || 'Unlinked'}`,
                inline: true,
              },
              { name: '🏷️ Assigned Nickname', value: `\`${serverNickname}\``, inline: true },
              { name: '🛡️ Approving Officer', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
              {
                name: '⏳ 2-Month Validity Window',
                value:
                  `• **Valid Thru:** <t:${expiresAtTimestamp}:F> (<t:${expiresAtTimestamp}:R>)\n` +
                  `• **Renewal Reminders:** You will receive proactive automated renewal alerts **10, 5, 3, and 1 days prior** to expiry!`,
                inline: false,
              },
              {
                name: '💡 Helpful Tips',
                value:
                  `• Run \`/card show\` anytime in **${serverName}** to display your registered card.\n` +
                  `• Run \`/card refresh\` if your Discord role or Roblox avatar changes in the future.\n` +
                  `• Your card contains a digital barcode and QR code for instant verification.`,
                inline: false,
              }
            )
            .setFooter({ text: `Official UOI Registry • ${serverName} • Serial: ${serialId}` })
            .setTimestamp();

          if (req.robloxAvatarUrl) {
            dmEmbed.setThumbnail(req.robloxAvatarUrl);
          }
          if (cardBuffer) {
            dmEmbed.setImage(`attachment://${fileName}`);
          }

          await recipientUser.send({
            content: `🔔 **Official Credential Notification:** You have been issued a Citizen ID card in **${serverName}**!`,
            embeds: [dmEmbed],
            files: dmFiles,
          });
          dmSent = true;
          console.log(`[UOI Bot] 📬 Successfully sent acceptance DM to ${req.targetUser.tag || req.targetUser.id} (${req.targetUser.id})`);
        }
      } catch (dmErr) {
        console.warn(`[UOI Bot] ⚠️ Could not send acceptance DM to ${req.targetUser.id} (user DMs may be closed):`, dmErr.message);
      }

      return safeEditReply(interaction, {
        content:
          `✅ **Card Successfully Issued!**\n` +
          `Serial ID: \`${serialId}\` created for <@${req.targetUser.id}>. Server database and records have been updated.\n` +
          (dmSent
            ? `📬 **Direct Message:** Sent official card and notification directly to <@${req.targetUser.id}>'s DMs!`
            : `⚠️ **Direct Message:** Could not DM <@${req.targetUser.id}> (their Discord DMs may be set to friends-only or closed).`),
      });
    }

    // 2. DECLINE WITH REASON (Pops up modal)
    if (customId.startsWith('card_decline_')) {
      const requestId = customId.replace('card_decline_', '');
      const req = db.pendingRequests?.[requestId];

      if (!req) {
        return safeReply(interaction, {
          content: `❌ Card application \`${requestId}\` not found in database.`,
          ephemeral: true,
        });
      }

      if (req.status !== 'PENDING') {
        return safeReply(interaction, {
          content: `⚠️ This request has already been marked as **${req.status}** by <@${req.reviewedBy?.discordId || 'Staff'}>.`,
          ephemeral: true,
        });
      }

      if (isApplicationExpired(req, guildConfig)) {
        req.status = 'EXPIRED';
        req.expiredAt = new Date().toISOString();
        saveDatabase(db);

        if (interaction.message) {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('card_expired_btn')
              .setLabel('Application Expired (48h Timeout)')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
              .setEmoji('⏰')
          );
          await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
        }

        return safeReply(interaction, {
          content: `⏰ **Application Expired:** This card request has exceeded its 48-hour review window and expired. The applicant has been unlocked to reapply.`,
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
      try {
        return await interaction.showModal(modal);
      } catch (modalErr) {
        console.warn('[UOI Bot] Notice showing decline modal:', modalErr.message);
        return null;
      }
    }
  },

  // ==========================================
  // MODAL SUBMIT HANDLER: Decline with Reason
  // ==========================================
  async handleModal(interaction) {
    const customId = interaction.customId;

    // Handle interactive application modal: card_modal_apply
    if (customId === 'card_modal_apply') {
      await interaction.deferReply({ ephemeral: false });
      const targetUser = interaction.user;
      const fullName = interaction.fields.getTextInputValue('fullName');
      const gender = interaction.fields.getTextInputValue('gender');
      const robloxQuery = interaction.fields.getTextInputValue('roblox') || null;
      const division = interaction.fields.getTextInputValue('division') || 'Civilian Directorate';

      const guildId = interaction.guildId;
      const db = loadDatabase();
      const guildConfig = db.guilds?.[guildId] || autoDetectAndSaveSetup(interaction.guild, interaction.channel);

      // Check existing active card
      const existingCard = getGuildCard(db, guildId, targetUser.id) || db.cards[targetUser.id];
      if (existingCard && existingCard.status === 'ACTIVE') {
        return interaction.editReply({
          content: `⚠️ **Card Generation Blocked:** You already possess an active UOI Citizen Card with Serial \`${existingCard.serialId}\` in this server!`,
        });
      }

      // Check if applicant already has a pending request awaiting review
      const existingPending = Object.values(db.pendingRequests || {}).find(
        (r) => r.status === 'PENDING' && r.guildId === guildId && r.targetUser?.id === targetUser.id
      );
      if (existingPending) {
        if (isApplicationExpired(existingPending, guildConfig)) {
          existingPending.status = 'EXPIRED';
          existingPending.expiredAt = new Date().toISOString();
          saveDatabase(db);
          console.log(`[UOI Bot] ⏰ Auto-expired stale pending request ${existingPending.id} for <@${targetUser.id}> on modal apply.`);
        } else {
          const expiresAtUnix = existingPending.expiresAtTimestamp || (existingPending.expiresAt ? Math.floor(new Date(existingPending.expiresAt).getTime() / 1000) : null);
          return interaction.editReply({
            content: `⏳ **Application Already Pending Review:** You already have an active card request (\`${existingPending.id}\`) awaiting review in <#${guildConfig.staffChannelId}>.${expiresAtUnix ? ` It expires <t:${expiresAtUnix}:R>.` : ''}`,
          });
        }
      }

      // Auto-scan member Discord roles
      let targetMember = null;
      if (interaction.guild) {
        try { targetMember = await interaction.guild.members.fetch(targetUser.id); } catch (_) {}
      }
      const scannedRankInfo = resolveCitizenRankFromRoles(targetMember || interaction.member);
      const assignedRank = scannedRankInfo.rankName;

      // Auto-detect Roblox account
      const robloxInfo = await autoDetectRobloxUser({
        member: targetMember || interaction.member,
        user: targetUser,
        guildId,
        guildConfig,
        manualQuery: robloxQuery,
      });

      if (!robloxInfo || !robloxInfo.detected || !robloxInfo.userId) {
        return interaction.editReply({
          content: `🔍 **Roblox Account Required:** Could not auto-detect a verified Roblox account. Please run \`/card link roblox:YourUsername\` or supply your username!`,
        });
      }

      const requestId = `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Calculate application expiration window (e.g. 48 hours)
      const appExpiryMs = getApplicationExpiryMs(guildConfig);
      const appExpiresAtDate = new Date(Date.now() + appExpiryMs);
      const appExpiresAt = appExpiresAtDate.toISOString();
      const appExpiresAtTimestamp = Math.floor(appExpiresAtDate.getTime() / 1000);

      db.pendingRequests = db.pendingRequests || {};
      const requestRecord = {
        id: requestId,
        guildId,
        targetUser: { id: targetUser.id, tag: targetUser.tag },
        applicantUser: { id: interaction.user.id, tag: interaction.user.tag },
        fullName,
        gender,
        assignedRank,
        division,
        clearanceLevel: computeClearanceLevel(assignedRank, division),
        scannedRoleId: scannedRankInfo.roleId,
        scannedRoleName: scannedRankInfo.roleName,
        scannedRolesCount: scannedRankInfo.scannedRolesCount,
        robloxUsername: robloxInfo.username,
        robloxUserId: robloxInfo.userId,
        robloxAvatarUrl: robloxInfo.avatarUrl,
        robloxDetectionMethod: robloxInfo.method,
        robloxDetectionConfidence: robloxInfo.confidence,
        robloxHasVerifiedBadge: robloxInfo.hasVerifiedBadge,
        submittedAt: new Date().toISOString(),
        expiresAt: appExpiresAt,
        expiresAtTimestamp: appExpiresAtTimestamp,
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

      // Post to staff channel
      let postedToStaff = false;
      try {
        const staffChannel = await interaction.guild.channels.fetch(guildConfig.staffChannelId);
        if (staffChannel && staffChannel.isTextBased()) {
          const staffEmbed = new EmbedBuilder()
            .setTitle(`🛡️ New Citizen Card Application: ${fullName}`)
            .setColor(0xf59e0b)
            .setDescription(`A citizen card application has been submitted via interactive modal.\n\n• **Citizen:** <@${targetUser.id}> (\`${targetUser.tag}\`)\n• **Division:** ${division}`)
            .addFields(
              { name: 'Full Citizen Name', value: fullName, inline: true },
              { name: 'Gender', value: gender, inline: true },
              { name: '🎖️ Auto-Scanned Role', value: scannedRankInfo.roleId ? `<@&${scannedRankInfo.roleId}> (\`${assignedRank}\`)` : `\`${assignedRank}\``, inline: true },
              { name: 'Roblox Identity', value: `[@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile)`, inline: true },
              { name: 'Request ID', value: `\`${requestId}\``, inline: true },
              { name: 'Submitted At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
              { name: '⏳ Application Expiry', value: `<t:${appExpiresAtTimestamp}:R> (<t:${appExpiresAtTimestamp}:f>)`, inline: true }
            )
            .setFooter({ text: `UOI Staff Review Queue • Request ${requestId}` })
            .setTimestamp();

          if (robloxInfo.avatarUrl) staffEmbed.setThumbnail(robloxInfo.avatarUrl);

          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`card_accept_${requestId}`).setLabel('Accept & Issue Card').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId(`card_decline_${requestId}`).setLabel('Decline with Reason').setStyle(ButtonStyle.Danger).setEmoji('❌')
          );

          const sentMsg = await staffChannel.send({ embeds: [staffEmbed], components: [actionRow] });
          requestRecord.staffChannelId = staffChannel.id;
          requestRecord.staffMessageId = sentMsg.id;
          saveDatabase(db);
          postedToStaff = true;
        }
      } catch (err) {
        console.error('[UOI Bot] Error posting modal application to staff:', err.message);
      }

      const applicantEmbed = new EmbedBuilder()
        .setTitle('📋 Application Submitted for Staff Review')
        .setColor(0x38bdf8)
        .setDescription(`**Your UOI Citizen Card application has been dispatched to Staff!**\n\nLinked to Roblox profile [@${robloxInfo.username}](https://www.roblox.com/users/${robloxInfo.userId}/profile).`)
        .addFields(
          { name: 'Request ID', value: `\`${requestId}\``, inline: true },
          { name: 'Full Name', value: fullName, inline: true },
          { name: 'Division', value: division, inline: true },
          { name: '🎖️ Auto-Scanned Server Role', value: scannedRankInfo.roleId ? `<@&${scannedRankInfo.roleId}> (\`${assignedRank}\`)` : `\`${assignedRank}\``, inline: true },
          { name: 'Staff Review Channel', value: `<#${guildConfig.staffChannelId}>`, inline: true },
          { name: '⏳ Review Timeout Window', value: `<t:${appExpiresAtTimestamp}:R> (Auto-expires if unreviewed)`, inline: true }
        )
        .setFooter({ text: 'Union of Indians Central Registry • Verification Queue' })
        .setTimestamp();

      if (robloxInfo.avatarUrl) applicantEmbed.setThumbnail(robloxInfo.avatarUrl);
      return interaction.editReply({ embeds: [applicantEmbed] });
    }

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

    if (isApplicationExpired(req, guildConfig)) {
      req.status = 'EXPIRED';
      req.expiredAt = new Date().toISOString();
      saveDatabase(db);
      return interaction.reply({ content: `⏰ **Application Expired:** Request \`${requestId}\` has exceeded its 48-hour review window and expired.`, ephemeral: true });
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

    // Send direct message (DM) notification to applicant with staff reason
    let declineDmSent = false;
    try {
      let recipientUser = null;
      try {
        recipientUser = await interaction.client.users.fetch(req.targetUser.id);
      } catch (_) {
        recipientUser = interaction.guild?.members?.cache?.get(req.targetUser.id)?.user || null;
      }

      if (recipientUser) {
        const serverName = interaction.guild ? interaction.guild.name : 'the server';
        const declineDmEmbed = new EmbedBuilder()
          .setTitle('📢 UOI Citizen Card Application Update')
          .setColor(0xef4444)
          .setDescription(
            `Hello **${req.fullName}**, your citizen card application for **${serverName}** has been **DECLINED** by staff.`
          )
          .addFields(
            { name: '🏛️ Server', value: serverName, inline: true },
            { name: '📋 Request ID', value: `\`${req.id}\``, inline: true },
            { name: '🛡️ Reviewing Officer', value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`, inline: true },
            { name: '❌ Reason for Rejection', value: reason, inline: false },
            {
              name: '🔄 How to Re-Apply',
              value: 'You may correct the issue mentioned above and submit a new application using `/card apply` or `/card generate` in the server.',
              inline: false,
            }
          )
          .setFooter({ text: `UOI Staff Review Notification • ${serverName}` })
          .setTimestamp();

        await recipientUser.send({ embeds: [declineDmEmbed] });
        declineDmSent = true;
        console.log(`[UOI Bot] 📬 Sent decline DM to ${req.targetUser.tag || req.targetUser.id}`);
      }
    } catch (dmErr) {
      console.warn(`[UOI Bot] Notice: Could not send decline notification DM to ${req.targetUser.id}:`, dmErr.message);
    }

    return interaction.editReply({
      content:
        `❌ **Card Application Declined.**\n` +
        `Request \`${requestId}\` marked as DECLINED with reason: "${reason}".\n` +
        (declineDmSent
          ? `📬 **Direct Message:** Sent rejection reason directly to <@${req.targetUser.id}>'s DMs.`
          : `⚠️ **Direct Message:** Could not DM <@${req.targetUser.id}> (DMs closed or friends-only).`),
    });
  },
};

export default cardCommand;
