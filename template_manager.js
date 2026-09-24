import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { loadServerMemory, saveServerMemory } from './memory.js';

const require = createRequire(import.meta.url);

// Native Canvas Engine with comprehensive resolution fallbacks
let createCanvas = null;
let loadImage = null;
let ImageClass = null;

try {
  const napi = await import('@napi-rs/canvas');
  createCanvas = napi?.createCanvas || napi?.default?.createCanvas || null;
  loadImage = napi?.loadImage || napi?.default?.loadImage || null;
  ImageClass = napi?.Image || napi?.default?.Image || null;
} catch (_) {}

if (!createCanvas || typeof createCanvas !== 'function' || !loadImage || typeof loadImage !== 'function') {
  try {
    const napiReq = require('@napi-rs/canvas');
    if (!createCanvas && typeof napiReq?.createCanvas === 'function') createCanvas = napiReq.createCanvas;
    if (!loadImage && typeof napiReq?.loadImage === 'function') loadImage = napiReq.loadImage;
    if (!ImageClass && napiReq?.Image) ImageClass = napiReq.Image;
  } catch (_) {}
}

if (!createCanvas || typeof createCanvas !== 'function' || !loadImage || typeof loadImage !== 'function') {
  try {
    const nodeCanvas = await import('canvas');
    if (!createCanvas) createCanvas = nodeCanvas?.createCanvas || nodeCanvas?.default?.createCanvas || null;
    if (!loadImage) loadImage = nodeCanvas?.loadImage || nodeCanvas?.default?.loadImage || null;
    if (!ImageClass) ImageClass = nodeCanvas?.Image || nodeCanvas?.default?.Image || null;
  } catch (_) {}
}

export const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
export const PUBLIC_DIR = path.join(process.cwd(), 'public');

export function ensureTemplateDirectories() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    try { fs.mkdirSync(TEMPLATES_DIR, { recursive: true }); } catch (_) {}
  }
  if (!fs.existsSync(PUBLIC_DIR)) {
    try { fs.mkdirSync(PUBLIC_DIR, { recursive: true }); } catch (_) {}
  }
}

/**
 * Ultra-safe loadImage helper
 */
export async function safeDecodeImage(source) {
  if (!source) return null;

  // 1. Primary path: try loadImage if available
  if (typeof loadImage === 'function') {
    try {
      if (Buffer.isBuffer(source)) {
        if (source.length === 0) return null;
        return await loadImage(source);
      }
      if (typeof source === 'string') {
        if (!fs.existsSync(source)) return null;
        const stat = fs.statSync(source);
        if (stat.size === 0) return null;
        return await loadImage(source);
      }
      return await loadImage(source);
    } catch (_) {}
  }

  // 2. Secondary fallback: use new Image() constructor if available
  if (ImageClass) {
    try {
      let buf = null;
      if (Buffer.isBuffer(source)) {
        buf = source;
      } else if (typeof source === 'string' && fs.existsSync(source)) {
        buf = fs.readFileSync(source);
      }
      if (buf && buf.length > 0) {
        const img = new ImageClass();
        img.src = buf;
        if (img.width && img.height) return img;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Sanitize and convert common image sharing URLs into direct download links
 */
export function sanitizeImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let url = rawUrl.trim();

  // Handle base64 Data URLs
  if (url.startsWith('data:image/')) return url;

  // Handle Google Drive share links
  const gDriveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (gDriveMatch) {
    return `https://drive.google.com/uc?export=download&id=${gDriveMatch[1]}`;
  }

  // Handle Dropbox share links
  if (url.includes('dropbox.com')) {
    url = url.replace(/\?dl=[01]/, '').replace(/\?raw=[01]/, '');
    return url + (url.includes('?') ? '&raw=1' : '?raw=1');
  }

  // Handle Imgur single image page links (e.g. imgur.com/ABC1234 -> i.imgur.com/ABC1234.png)
  const imgurMatch = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)$/);
  if (imgurMatch && !['gallery', 'a', 't', 'upload'].includes(imgurMatch[1])) {
    return `https://i.imgur.com/${imgurMatch[1]}.png`;
  }

  return url;
}

/**
 * Fetch image bytes with CDN fallbacks and browser headers
 */
export async function fetchImageBytes(target, timeoutMs = 15000) {
  const candidateUrls = [];

  if (typeof target === 'object' && target !== null) {
    // Discord.js Attachment object
    if (target.url) candidateUrls.push(sanitizeImageUrl(target.url));
    if (target.proxyURL) candidateUrls.push(sanitizeImageUrl(target.proxyURL));
  } else if (typeof target === 'string') {
    // String URL or Data URL
    if (target.startsWith('data:image/')) {
      const match = target.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
      if (match) {
        return { buffer: Buffer.from(match[1], 'base64'), contentType: 'image/png' };
      }
      throw new Error('Invalid base64 data URL format.');
    }
    candidateUrls.push(sanitizeImageUrl(target));
  }

  if (candidateUrls.length === 0) {
    throw new Error('No valid URL or attachment provided.');
  }

  let lastError = null;

  for (const url of candidateUrls) {
    if (!url) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8',
        },
      });
      clearTimeout(timer);

      if (!resp.ok) {
        lastError = new Error(`HTTP error ${resp.status} (${resp.statusText}) from host.`);
        continue;
      }

      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) {
        lastError = new Error(
          'The provided URL returned a webpage (HTML) rather than a direct image file. Please provide a direct image link ending in .png, .jpg, or attach the file directly.'
        );
        continue;
      }

      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (!buffer || buffer.length < 50) {
        lastError = new Error('The downloaded file is empty or too small to be a valid image.');
        continue;
      }

      return { buffer, contentType };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to retrieve image data from the provided source.');
}

/**
 * Process and normalize template buffer into a pristine 1200x900 PNG
 */
export async function processAndNormalizeTemplate(rawBuffer) {
  if (!rawBuffer || rawBuffer.length < 50) {
    throw new Error('Template image buffer is empty.');
  }

  // Verify that the buffer is decodable
  const decodedImg = await safeDecodeImage(rawBuffer);
  if (!decodedImg || !decodedImg.width || !decodedImg.height) {
    throw new Error(
      'Could not decode image data. Please ensure the file is a valid PNG, JPG, or WebP image.'
    );
  }

  const originalWidth = decodedImg.width;
  const originalHeight = decodedImg.height;

  // Standardize to official 1200x900 canvas if engine is available
  if (createCanvas && typeof createCanvas === 'function') {
    const canvas = createCanvas(1200, 900);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(decodedImg, 0, 0, 1200, 900);

    let normalizedBuffer = null;
    if (typeof canvas.encode === 'function') {
      normalizedBuffer = await canvas.encode('png');
    } else if (typeof canvas.toBuffer === 'function') {
      normalizedBuffer = canvas.toBuffer('image/png');
    }

    if (normalizedBuffer && normalizedBuffer.length > 50) {
      return {
        buffer: normalizedBuffer,
        originalWidth,
        originalHeight,
        width: 1200,
        height: 900,
        normalized: true,
      };
    }
  }

  return {
    buffer: rawBuffer,
    originalWidth,
    originalHeight,
    width: originalWidth,
    height: originalHeight,
    normalized: false,
  };
}

/**
 * Save template image for a specific server (1 template per server isolation)
 */
export function saveServerTemplate(guildId, pngBuffer, metadata = {}) {
  ensureTemplateDirectories();

  if (guildId) {
    // Delete any old files for this guild with different extensions
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const p = path.join(TEMPLATES_DIR, `${guildId}.${ext}`);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    }
    const targetPath = path.join(TEMPLATES_DIR, `${guildId}.png`);
    fs.writeFileSync(targetPath, pngBuffer);

    // Sync with permanent memory
    try {
      const memory = loadServerMemory();
      if (memory.servers && memory.servers[guildId]) {
        memory.servers[guildId].template = {
          hasCustomTemplate: true,
          updatedAt: new Date().toISOString(),
          fileName: `${guildId}.png`,
          width: metadata.width || 1200,
          height: metadata.height || 900,
          originalWidth: metadata.originalWidth || metadata.width || 1200,
          originalHeight: metadata.originalHeight || metadata.height || 900,
          fileSizeBytes: pngBuffer.length,
        };
        saveServerMemory(memory);
      }
    } catch (memErr) {
      console.warn('[UOI Bot] Memory sync warning:', memErr.message);
    }

    return { path: targetPath, isCustom: true };
  } else {
    // Global fallback
    const targetPath = path.join(TEMPLATES_DIR, 'default.png');
    fs.writeFileSync(targetPath, pngBuffer);
    fs.writeFileSync('template.png', pngBuffer);
    return { path: targetPath, isCustom: false };
  }
}

/**
 * Delete / reset a server's custom template back to default
 */
export function deleteServerTemplate(guildId) {
  ensureTemplateDirectories();
  if (!guildId) return false;

  let removed = false;
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join(TEMPLATES_DIR, `${guildId}.${ext}`);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        removed = true;
      } catch (_) {}
    }
  }

  // Update permanent memory
  try {
    const memory = loadServerMemory();
    if (memory.servers && memory.servers[guildId]) {
      memory.servers[guildId].template = {
        hasCustomTemplate: false,
        updatedAt: new Date().toISOString(),
        fileName: null,
      };
      saveServerMemory(memory);
    }
  } catch (_) {}

  return removed;
}

/**
 * Generate official UOI default template (1200x900)
 */
export async function generateAndSaveDefaultTemplate() {
  ensureTemplateDirectories();
  if (!createCanvas || typeof createCanvas !== 'function') return null;

  try {
    const canvas = createCanvas(1200, 900);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. High-Tech Dark Background with subtle grid lines
    const bg = ctx.createLinearGradient(0, 0, 1200, 900);
    bg.addColorStop(0, '#090e1c');
    bg.addColorStop(0.4, '#060a15');
    bg.addColorStop(1, '#03050b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 900);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 40; x < 1200; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 900);
      ctx.stroke();
    }
    for (let y = 40; y < 900; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1200, y);
      ctx.stroke();
    }

    // 2. Dual Gold Security Border
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, 1168, 868);

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(24, 24, 1152, 852);

    // Corner decorative brackets
    const bracketSize = 28;
    const corners = [
      [24, 24, 1, 1],
      [1176, 24, -1, 1],
      [24, 876, 1, -1],
      [1176, 876, -1, -1],
    ];
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    corners.forEach(([cx, cy, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * bracketSize);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * bracketSize, cy);
      ctx.stroke();
    });

    // 3. Header Bar
    const headerGrad = ctx.createLinearGradient(24, 24, 1176, 24);
    headerGrad.addColorStop(0, 'rgba(180, 83, 9, 0.6)');
    headerGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.3)');
    headerGrad.addColorStop(1, 'rgba(56, 189, 248, 0.4)');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(24, 24, 1152, 8);

    // UOI Title & Seal Crest
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 36px "Liberation Sans", "Nimbus Sans", -apple-system, sans-serif';
    ctx.fillText('UNION OF INDIANS', 60, 95);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px "Liberation Sans", "Nimbus Sans", -apple-system, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText('OFFICIAL CITIZEN IDENTIFICATION CARD • CENTRAL REGISTRY', 60, 122);

    // Decorative Holographic Chip Box
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1020, 60, 120, 70);
    ctx.fillRect(1020, 60, 120, 70);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('SECURITY CHIP', 1032, 84);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px monospace';
    ctx.fillText('BIO-ENCRYPTED', 1032, 104);
    ctx.fillText('UOI-ID-v2', 1032, 118);

    // 4. Portrait Frame Area (60, 324, 337, 344)
    const px = 60, py = 324, pw = 337, ph = 344;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(px, py, pw, ph);

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // Corner crosshairs on portrait
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    const ch = 14;
    ctx.beginPath();
    ctx.moveTo(px, py + ch); ctx.lineTo(px, py); ctx.lineTo(px + ch, py);
    ctx.moveTo(px + pw, py + ch); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw - ch, py);
    ctx.moveTo(px, py + ph - ch); ctx.lineTo(px, py + ph); ctx.lineTo(px + ch, py + ph);
    ctx.moveTo(px + pw, py + ph - ch); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px + pw - ch, py + ph);
    ctx.stroke();

    // Portrait label
    ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CITIZEN BIOMETRIC PORTRAIT', px + pw / 2, py + ph / 2);
    ctx.textAlign = 'left';

    // 5. Rank Box Area (54, 687, 348, 46)
    const rx = 54, ry = 687, rw = 348, rh = 46;
    ctx.fillStyle = '#080d19';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);

    // 6. Data Fields Container (right side)
    const fieldX = 472;
    const fieldRows = [
      { label: 'CITIZEN FULL NAME', y: 320, valY: 358 },
      { label: 'ROBLOX IDENTITY', y: 408, valY: 446 },
      { label: 'CITIZEN ID NUMBER', y: 496, valY: 534 },
      { label: 'GENDER', y: 584, valY: 622 },
      { label: 'SECURITY CLEARANCE / RANK', y: 672, valY: 710 },
    ];

    fieldRows.forEach((row) => {
      // Label
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 12px "Liberation Sans", -apple-system, sans-serif';
      ctx.fillText(row.label, fieldX + 18, row.y);

      // Underline / divider
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fieldX + 18, row.valY + 14);
      ctx.lineTo(1140, row.valY + 14);
      ctx.stroke();
    });

    // 7. Security Microprint & Footer
    ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.font = '9px monospace';
    ctx.fillText('OFFICIAL UNION OF INDIANS CITIZEN IDENTIFICATION CARD • ISSUED UNDER HIGH COMMAND AUTHORITY • SECURE ENCRYPTED', 60, 856);

    let defaultBuffer = null;
    if (typeof canvas.encode === 'function') {
      defaultBuffer = await canvas.encode('png');
    } else if (typeof canvas.toBuffer === 'function') {
      defaultBuffer = canvas.toBuffer('image/png');
    }

    if (defaultBuffer) {
      const defPath = path.join(TEMPLATES_DIR, 'default.png');
      fs.writeFileSync(defPath, defaultBuffer);
      fs.writeFileSync('template.png', defaultBuffer);
      try {
        fs.writeFileSync(path.join(PUBLIC_DIR, 'template.png'), defaultBuffer);
      } catch (_) {}
      return { buffer: defaultBuffer, filePath: defPath };
    }
  } catch (err) {
    console.error('[UOI Bot] Error generating default template:', err);
  }
  return null;
}

/**
 * Resolve template for a specific guild
 */
export async function resolveTemplateImage(guildId) {
  ensureTemplateDirectories();

  // 1. Server-specific template check (1 template per server isolation)
  if (guildId) {
    const serverFiles = [
      path.join(TEMPLATES_DIR, `${guildId}.png`),
      path.join(TEMPLATES_DIR, `${guildId}.jpg`),
      path.join(TEMPLATES_DIR, `${guildId}.jpeg`),
      path.join(TEMPLATES_DIR, `${guildId}.webp`),
    ];
    for (const f of serverFiles) {
      if (fs.existsSync(f)) {
        const img = await safeDecodeImage(f);
        if (img) return { img, source: `Server Custom Template (${guildId})`, filePath: f, isCustom: true };
      }
    }
  }

  // 2. Global fallback candidates
  const candidateFiles = [
    path.join(TEMPLATES_DIR, 'default.png'),
    'template.png',
    'template.jpg',
    'template.jpeg',
    path.join(PUBLIC_DIR, 'template.png'),
  ];

  for (const filename of candidateFiles) {
    if (fs.existsSync(filename)) {
      const img = await safeDecodeImage(filename);
      if (img) return { img, source: `Default Official Template (${path.basename(filename)})`, filePath: filename, isCustom: false };
    }
  }

  // 3. Generate default template if none exists
  const def = await generateAndSaveDefaultTemplate();
  if (def && def.buffer) {
    const img = await safeDecodeImage(def.buffer);
    if (img) return { img, source: 'Official Standard UOI Template', filePath: def.filePath, isCustom: false };
  }

  return { img: null, source: null, filePath: null, isCustom: false };
}

/**
 * Get metadata about a server's template
 */
export function getServerTemplateStatus(guildId) {
  ensureTemplateDirectories();
  if (!guildId) {
    const defPath = path.join(TEMPLATES_DIR, 'default.png');
    const exists = fs.existsSync(defPath);
    return {
      hasCustomTemplate: false,
      hasDefaultTemplate: exists,
      filePath: exists ? defPath : null,
    };
  }

  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join(TEMPLATES_DIR, `${guildId}.${ext}`);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      return {
        hasCustomTemplate: true,
        fileName: `${guildId}.${ext}`,
        filePath: p,
        fileSizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    }
  }

  const defPath = path.join(TEMPLATES_DIR, 'default.png');
  const hasDefault = fs.existsSync(defPath);
  return {
    hasCustomTemplate: false,
    hasDefaultTemplate: hasDefault,
    filePath: hasDefault ? defPath : null,
  };
}
