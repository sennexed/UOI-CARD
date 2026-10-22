import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, Events } from 'discord.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { cardCommand, getCanvasEngineInfo, loadDatabase } from './commands/card.js';
import {
  syncGuildsMemory,
  recordServer,
  autoDetectAndSaveSetup,
  markServerLeft,
  loadServerMemory,
  getAllServerRecords,
} from './memory.js';
import {
  getServerTemplateStatus,
  resolveTemplateImage,
  processAndNormalizeTemplate,
  saveServerTemplate,
  deleteServerTemplate,
  fetchImageBytes,
  generateAndSaveDefaultTemplate,
  TEMPLATES_DIR,
} from './template_manager.js';
import {
  autoDetectRobloxUser,
  fetchRobloxUserData,
  extractRobloxCandidates,
} from './roblox_detector.js';
import {
  getGitStatus,
  handleGitHubWebhook,
  startGitCommitWatcher,
  pullLatestCode,
  gracefulRestart,
  initGitState,
} from './git_sync.js';

// Pre-cache static HTML dashboard in memory for instant 0ms responses
let _cachedHtml = null;
let _cachedHtmlMtime = 0;
function getCachedDashboardHtml() {
  const htmlPath = path.join(process.cwd(), 'index.html');
  try {
    if (fs.existsSync(htmlPath)) {
      const stat = fs.statSync(htmlPath);
      if (!_cachedHtml || stat.mtimeMs > _cachedHtmlMtime) {
        _cachedHtml = fs.readFileSync(htmlPath, 'utf8');
        _cachedHtmlMtime = stat.mtimeMs;
      }
      return _cachedHtml;
    }
  } catch (_) {}
  return _cachedHtml;
}

// 1. Lightweight HTTP Healthcheck & Status server for Cloud Run / Pterodactyl / WispByte
const DEFAULT_PORT = 3000;
const CLOUD_RUN_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

const requestHandler = async (req, res) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    parsedUrl = { pathname: '/', searchParams: new URLSearchParams() };
  }
  const urlPath = parsedUrl.pathname;
  const guildId = parsedUrl.searchParams.get('guildId') || parsedUrl.searchParams.get('server');

  // CORS headers for local dashboard interactions
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }


  // API: Live Citizen Verification for Roblox games and external systems
  if (urlPath === '/api/v1/verify' || urlPath === '/api/verify') {
    const serial = (parsedUrl.searchParams.get('serial') || parsedUrl.searchParams.get('id') || '').trim().toUpperCase();
    const robloxId = (parsedUrl.searchParams.get('robloxId') || parsedUrl.searchParams.get('uid') || '').trim();
    const discordId = (parsedUrl.searchParams.get('discordId') || '').trim();

    const db = loadDatabase();
    let card = null;

    if (serial) {
      const uId = db.serToUser?.[serial];
      if (uId && db.cards[uId]) card = db.cards[uId];
    } else if (robloxId) {
      card = Object.values(db.cards || {}).find(c => String(c.robloxUserId) === String(robloxId));
    } else if (discordId) {
      card = db.cards?.[discordId] || null;
    }

    if (!card) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        verified: false,
        message: 'No matching official UOI Citizen Card found in registry.',
        query: { serial, robloxId, discordId },
      }));
    }

    const isRevoked = card.status === 'REVOKED';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      verified: !isRevoked,
      status: card.status || 'ACTIVE',
      card: {
        serialId: card.serialId,
        fullName: card.fullName,
        robloxUsername: card.robloxUsername,
        robloxUserId: card.robloxUserId,
        gender: card.gender,
        assignedRank: card.assignedRank,
        division: card.division || 'Civilian Directorate',
        clearanceLevel: card.clearanceLevel || 'LEVEL I (GENERAL CITIZEN)',
        issuedAt: card.issuedAt,
        status: card.status,
        revokedAt: card.revokedAt || null,
        revokeReason: card.revokeReason || null,
        avatarUrl: card.avatarUrl,
      },
    }));
  }

  // PUBLIC WEB VERIFICATION PORTAL (/verify and /verify/:serial)
  if (urlPath === '/verify' || urlPath.startsWith('/verify/')) {
    let querySerial = parsedUrl.searchParams.get('serial') || parsedUrl.searchParams.get('id') || '';
    if (!querySerial && urlPath.startsWith('/verify/')) {
      querySerial = decodeURIComponent(urlPath.replace('/verify/', '').trim());
    }
    querySerial = querySerial.toUpperCase();

    const db = loadDatabase();
    let card = null;
    if (querySerial) {
      const uId = db.serToUser?.[querySerial];
      if (uId && db.cards[uId]) card = db.cards[uId];
    }

    const isValid = !!card && card.status === 'ACTIVE';
    const isRevoked = !!card && card.status === 'REVOKED';

    const verifyHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UOI Identity Verification System</title>
  <style>
    :root {
      --bg: #060911;
      --card: #0d1527;
      --border: #1e293b;
      --gold: #f59e0b;
      --blue: #38bdf8;
      --green: #10b981;
      --red: #ef4444;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 10%, #172554 0%, var(--bg) 70%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 580px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .header {
      background: linear-gradient(90deg, #b45309 0%, #1e1b4b 50%, #065f46 100%);
      padding: 20px;
      text-align: center;
      border-bottom: 2px solid var(--gold);
    }
    .header h1 { font-size: 18px; letter-spacing: 2px; text-transform: uppercase; color: #fff; }
    .header p { font-size: 12px; color: #cbd5e1; letter-spacing: 1px; margin-top: 4px; }
    .status-banner {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 1px;
    }
    .status-active { background: rgba(16, 185, 129, 0.15); color: #34d399; border-bottom: 1px solid rgba(16, 185, 129, 0.3); }
    .status-revoked { background: rgba(239, 68, 68, 0.15); color: #f87171; border-bottom: 1px solid rgba(239, 68, 68, 0.3); }
    .status-unknown { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-bottom: 1px solid rgba(245, 158, 11, 0.3); }
    .content { padding: 24px; }
    .avatar-wrap {
      display: flex;
      gap: 18px;
      align-items: center;
      margin-bottom: 20px;
    }
    .avatar-img {
      width: 90px;
      height: 90px;
      border-radius: 12px;
      border: 2px solid var(--gold);
      background: #020617;
      object-fit: cover;
    }
    .name-block h2 { font-size: 20px; color: #fff; font-weight: 800; }
    .name-block p { font-size: 13px; color: var(--blue); font-family: monospace; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .field { background: rgba(15, 23, 42, 0.6); padding: 10px 14px; border-radius: 8px; border: 1px solid #1e293b; }
    .field-label { font-size: 10px; color: var(--muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .field-value { font-size: 13px; font-weight: 700; color: #fff; margin-top: 2px; }
    .search-box {
      margin-top: 15px;
      display: flex;
      gap: 8px;
    }
    .search-input {
      flex: 1;
      background: #090e1c;
      border: 1px solid var(--border);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-family: monospace;
    }
    .search-btn {
      background: var(--gold);
      color: #000;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
    }
    .footer {
      text-align: center;
      padding: 14px;
      font-size: 11px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      background: rgba(0,0,0,0.2);
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="header">
      <h1>Union of Indians</h1>
      <p>CENTRAL CITIZEN IDENTITY & DOSSIER REGISTRY</p>
    </div>

    ${isValid ? `
      <div class="status-banner status-active">
        <span>🟢</span> OFFICIAL VERIFIED CITIZEN IDENTIFICATION
      </div>
      <div class="content">
        <div class="avatar-wrap">
          <img class="avatar-img" src="${card.avatarUrl || 'https://via.placeholder.com/150'}" alt="Avatar" />
          <div class="name-block">
            <h2>${card.fullName}</h2>
            <p>@${card.robloxUsername || 'UNLINKED'}</p>
            <p style="color: var(--gold); margin-top: 4px; font-weight: bold;">${card.assignedRank || 'CITIZEN'}</p>
          </div>
        </div>

        <div class="grid">
          <div class="field">
            <div class="field-label">Official Serial ID</div>
            <div class="field-value" style="font-family: monospace; color: var(--blue);">${card.serialId}</div>
          </div>
          <div class="field">
            <div class="field-label">Clearance Tier</div>
            <div class="field-value" style="color: var(--gold);">${card.clearanceLevel || 'LEVEL I (CITIZEN)'}</div>
          </div>
          <div class="field">
            <div class="field-label">Government Division</div>
            <div class="field-value">${card.division || 'Civilian Directorate'}</div>
          </div>
          <div class="field">
            <div class="field-label">Roblox User ID</div>
            <div class="field-value" style="font-family: monospace;">${card.robloxUserId || 'N/A'}</div>
          </div>
          <div class="field">
            <div class="field-label">Gender</div>
            <div class="field-value">${card.gender || 'N/A'}</div>
          </div>
          <div class="field">
            <div class="field-label">Date of Issuance</div>
            <div class="field-value">${card.issuedAt ? new Date(card.issuedAt).toLocaleDateString() : 'Active'}</div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 10px;">
          <a href="/dashboard" style="color: var(--blue); font-size: 12px; text-decoration: none;">&larr; Return to Central System Dashboard</a>
        </div>
      </div>
    ` : isRevoked ? `
      <div class="status-banner status-revoked">
        <span>🚨</span> WARNING: CITIZEN CARD HAS BEEN REVOKED
      </div>
      <div class="content">
        <h2 style="color: var(--red); margin-bottom: 10px;">Document Revoked & Blacklisted</h2>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 16px;">This identification card was revoked by Union security command. It is no longer valid for official entry, verification, or service authorization.</p>
        <div class="field" style="margin-bottom: 12px;">
          <div class="field-label">Revoked Serial</div>
          <div class="field-value" style="color: var(--red); font-family: monospace;">${card.serialId}</div>
        </div>
        <div class="field">
          <div class="field-label">Revocation Reason</div>
          <div class="field-value">${card.revokeReason || 'Administrative revocation'}</div>
        </div>
      </div>
    ` : `
      <div class="status-banner status-unknown">
        <span>🔍</span> CENTRAL REGISTRY SERIAL LOOKUP
      </div>
      <div class="content">
        ${querySerial ? `<p style="color: var(--red); font-size: 13px; margin-bottom: 14px;">❌ Serial <code>${querySerial}</code> was not found in the official registry.</p>` : ''}
        <p style="font-size: 13px; color: var(--muted);">Enter a UOI Citizen Serial ID (e.g. <code>UOI-2026-123456</code>) to verify authenticity and clearance status:</p>
        <form method="GET" action="/verify" class="search-box">
          <input class="search-input" type="text" name="serial" placeholder="e.g. UOI-2026-839102" value="${querySerial || ''}" required />
          <button class="search-btn" type="submit">Verify Record</button>
        </form>
        <div style="text-align: center; margin-top: 20px;">
          <a href="/" style="color: var(--blue); font-size: 12px; text-decoration: none;">&larr; View System Dashboard</a>
        </div>
      </div>
    `}

    <div class="footer">
      Official Verification Engine • Union of Indians Ministry of Home Affairs • Encrypted Barcode & QR Registry
    </div>
  </div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(verifyHtml);
  }

  // API: Get Template Image (Serves binary PNG for previewing)
  if (urlPath === '/api/template') {
    try {
      const resolved = await resolveTemplateImage(guildId);
      let fileBuf = null;
      if (resolved.filePath && fs.existsSync(resolved.filePath)) {
        fileBuf = fs.readFileSync(resolved.filePath);
      }
      if (!fileBuf) {
        const def = await generateAndSaveDefaultTemplate();
        if (def && def.buffer) fileBuf = def.buffer;
      }
      if (fileBuf) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': fileBuf.length,
          'Cache-Control': 'public, max-age=30',
        });
        return res.end(fileBuf);
      }
    } catch (err) {
      console.warn('[UOI Bot] Error serving template image:', err.message);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Template not found');
  }

  // API: Get Template Status & Blueprint Info
  if (urlPath === '/api/template/info') {
    const status = getServerTemplateStatus(guildId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        guildId: guildId || null,
        status,
        standardResolution: '1200x900',
        alignmentGrid: {
          photoFrame: { x: 60, y: 324, w: 337, h: 344 },
          rankBox: { x: 54, y: 687, w: 348, h: 46 },
          fieldX: 472,
          rowY: [358, 446, 534, 622, 710],
          serialId: { x: 1010, y: 36 },
        },
      })
    );
  }

  // API: Upload template from Web Dashboard
  if (urlPath === '/api/template/upload' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const json = JSON.parse(rawBody);
        const targetGuildId = json.guildId || guildId;
        const inputData = json.imageBase64 || json.url;

        if (!inputData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No imageBase64 or url provided.' }));
        }

        const { buffer: rawBuffer } = await fetchImageBytes(inputData, 15000);
        const normalized = await processAndNormalizeTemplate(rawBuffer);

        saveServerTemplate(targetGuildId, normalized.buffer, {
          width: normalized.width,
          height: normalized.height,
          originalWidth: normalized.originalWidth,
          originalHeight: normalized.originalHeight,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: true,
            message: 'Template successfully uploaded, normalized, and saved.',
            guildId: targetGuildId,
            resolution: `${normalized.width}x${normalized.height}`,
            originalResolution: `${normalized.originalWidth}x${normalized.originalHeight}`,
            fileSizeBytes: normalized.buffer.length,
          })
        );
      } catch (err) {
        console.error('[UOI Bot] Dashboard template upload error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Reset template back to default
  if (urlPath === '/api/template/reset' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const json = JSON.parse(rawBody || '{}');
        const targetGuildId = json.guildId || guildId;

        deleteServerTemplate(targetGuildId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: true,
            message: 'Server template removed, reverted to standard default template.',
            guildId: targetGuildId,
          })
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Roblox auto-detection & lookup tester
  if (urlPath === '/api/roblox/detect') {
    const query = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query');
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing query parameter "q"' }));
    }

    try {
      const mockMember = {
        nickname: query,
        displayName: query,
        user: { username: query },
      };
      const result = await autoDetectRobloxUser({
        member: mockMember,
        manualQuery: query,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // API: GitHub Webhook Handler (Auto-restarts server when repo receives commits)
  if (
    (urlPath === '/api/webhook/github' ||
      urlPath === '/webhook' ||
      urlPath === '/api/git/push' ||
      urlPath === '/api/webhook') &&
    req.method === 'POST'
  ) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const rawBuffer = Buffer.concat(chunks);
      await handleGitHubWebhook(req, res, rawBuffer);
    });
    return;
  }

  // API: Git & Deployment Status
  if (urlPath === '/api/git/status' || urlPath === '/api/git') {
    const status = getGitStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(status));
  }

  // API: Manual Git Pull & Server Restart (supports ?force=true)
  if (urlPath === '/api/git/sync' && req.method === 'POST') {
    const isForce = parsedUrl.searchParams.get('force') === 'true';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        message: isForce
          ? 'Force sync initiated. Resetting to remote origin and restarting...'
          : 'Sync initiated. Pulling latest code and restarting server...',
      })
    );
    pullLatestCode({ force: isForce }).then(() => {
      gracefulRestart(isForce ? 'Dashboard Force Git Reset' : 'Dashboard Manual Git Sync');
    });
    return;
  }

  if (
    urlPath === '/api/health' ||
    urlPath === '/health' ||
    urlPath === '/healthz' ||
    urlPath === '/_health' ||
    urlPath === '/ready'
  ) {
    const memory = loadServerMemory();
    const serverList = Object.values(memory.servers || {});
    const canvasInfo = getCanvasEngineInfo ? getCanvasEngineInfo() : { engine: 'unknown' };
    const gitInfo = getGitStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        status: 'online',
        service: 'Union of Indians (UOI) Discord Bot',
        botReady: !!(globalThis.__uoiBotClient && globalThis.__uoiBotClient.isReady()),
        uptimeSeconds: Math.floor(process.uptime()),
        canvasEngine: canvasInfo,
        git: gitInfo,
        permanentMemory: {
          totalRememberedServers: serverList.length,
          activeSetups: serverList.filter((s) => s.setup?.isSetup).length,
          autoConfiguredCount: serverList.filter((s) => s.setup?.autoConfigured).length,
          servers: serverList.map((s) => ({
            id: s.guildId,
            name: s.name,
            isSetup: !!s.setup?.isSetup,
            autoConfigured: !!s.setup?.autoConfigured,
            staffChannel: s.setup?.staffChannelName || null,
            firstSeen: s.firstSeen,
            lastSeen: s.lastSeen,
            isPresent: s.isCurrentlyPresent,
          })),
        },
      })
    );
  }

  // Serve static HTML status dashboard (Instant 0ms in-memory cache)
  const cachedHtml = getCachedDashboardHtml();
  if (cachedHtml) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    return res.end(cachedHtml);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Union of Indians (UOI) Discord Bot is active.');
};

// Start listener on Port 3000 (standard for local dev proxy)
const server3000 = http.createServer(requestHandler);
server3000.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[UOI Bot] Note: Port ${DEFAULT_PORT} is occupied, running in background bot mode.`);
  } else {
    console.warn(`[UOI Bot] Port ${DEFAULT_PORT} notice:`, err.message);
  }
});
server3000.listen(DEFAULT_PORT, '0.0.0.0', () => {
  console.log(`[UOI Bot] 🌐 Healthcheck listener active on port ${DEFAULT_PORT}`);
  startGitCommitWatcher();
});

// Start listener on Cloud Run deployment port if specified and different from 3000
if (CLOUD_RUN_PORT && CLOUD_RUN_PORT !== DEFAULT_PORT) {
  const serverCloudRun = http.createServer(requestHandler);
  serverCloudRun.on('error', (err) => {
    // In dev container, nginx occupies 8080, which is normal and expected
    if (err.code !== 'EADDRINUSE') {
      console.warn(`[UOI Bot] Cloud Run port ${CLOUD_RUN_PORT} notice:`, err.message);
    }
  });
  serverCloudRun.listen(CLOUD_RUN_PORT, '0.0.0.0', () => {
    console.log(`[UOI Bot] 🌐 Cloud Run listener active on port ${CLOUD_RUN_PORT}`);
  });
}

// 2. Discord Bot Authentication & Slash Command Setup
const token = (process.env.DISCORD_TOKEN || '').trim();

if (!token || token === 'your_bot_token_here' || token.includes('your_token')) {
  console.log('===============================================================');
  console.log('⚠️  [UOI Bot] DISCORD_TOKEN is not configured yet!');
  console.log('👉 To connect your Discord Bot:');
  console.log('   1. In WispByte, open the "Files" tab.');
  console.log('   2. Create or edit the ".env" file.');
  console.log('   3. Put your bot token:');
  console.log('      DISCORD_TOKEN=your_token_from_discord_developer_portal');
  console.log('   4. Click "Restart" in the Console tab.');
  console.log('===============================================================');
} else {
  console.log('[UOI Bot] Connecting to Discord Gateway...');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  globalThis.__uoiBotClient = client;

  client.once(Events.ClientReady, async () => {
    console.log(`[UOI Bot] ✅ Successfully logged in as ${client.user.tag}`);

    // Register /card slash command with Discord REST API
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      console.log('[UOI Bot] Registering /card slash command with Discord API...');
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: [cardCommand.data.toJSON()] }
      );
      console.log('[UOI Bot] ✅ Slash command /card registered successfully!');
    } catch (err) {
      console.error('[UOI Bot] ❌ Error registering slash commands:', err.message);
    }

    // Synchronize permanent server memory registry
    try {
      console.log('[UOI Bot] 🧠 Synchronizing permanent server memory and setups...');
      await syncGuildsMemory(client);
    } catch (memErr) {
      console.warn('[UOI Bot] Notice during guild memory sync:', memErr.message);
    }

    // Apply Font 10 (Sinistre Vampyre) with Dark Orange, White & Dark Green Gradient Style across all servers
    try {
      console.log('[UOI Bot] 🎨 Applying Font 10 (Sinistre) with Dark Orange, White & Dark Green Gradient...');
      const guilds = await client.guilds.fetch();
      for (const [guildId, oauthGuild] of guilds) {
        try {
          // Attempt with 3 colors: Dark Orange, White, Dark Green
          await rest.patch(`/guilds/${guildId}/members/@me`, {
            body: {
              display_name_font_id: 10,        // 10th Font: Sinistre (Vampyre / Gothic)
              display_name_effect_id: 2,      // Gradient effect
              display_name_colors: [0xd95700, 0xffffff, 0x0d652d], // Dark Orange (#D95700), White (#FFFFFF), Dark Green (#0D652D)
            },
          });
          console.log(`[UOI Bot] 🎨 Applied Font 10 Tricolor Gradient to: ${oauthGuild.name} (${guildId})`);
        } catch (firstErr) {
          // If Discord API strictly restricts gradient array to max 2 items, fall back to Dark Orange & Dark Green
          try {
            await rest.patch(`/guilds/${guildId}/members/@me`, {
              body: {
                display_name_font_id: 10,
                display_name_effect_id: 2,
                display_name_colors: [0xd95700, 0x0d652d], // Dark Orange & Dark Green
              },
            });
            console.log(`[UOI Bot] 🎨 Applied Font 10 Two-Tone Gradient to: ${oauthGuild.name} (${guildId})`);
          } catch (guildStyleErr) {
            console.warn(`[UOI Bot] Notice: Could not set name style in guild ${guildId}:`, guildStyleErr.message);
          }
        }
      }
    } catch (styleErr) {
      console.warn('[UOI Bot] Name styling notice:', styleErr.message);
    }
  });

  // Automatically remember server and style bot name when added to a new server
  client.on('guildCreate', async (guild) => {
    try {
      // 1. Permanently record server and auto-configure zero-config setup
      recordServer(guild);
      autoDetectAndSaveSetup(guild);
      console.log(`[UOI Bot] 🧠 Permanent memory saved for server: ${guild.name} (${guild.id})`);

      // 2. Apply Font 10 styling
      const rest = new REST({ version: '10' }).setToken(token);
      try {
        await rest.patch(`/guilds/${guild.id}/members/@me`, {
          body: {
            display_name_font_id: 10,
            display_name_effect_id: 2, // Gradient
            display_name_colors: [0xd95700, 0xffffff, 0x0d652d], // Dark Orange, White, Dark Green
          },
        });
      } catch (_) {
        await rest.patch(`/guilds/${guild.id}/members/@me`, {
          body: {
            display_name_font_id: 10,
            display_name_effect_id: 2,
            display_name_colors: [0xd95700, 0x0d652d],
          },
        });
      }
      console.log(`[UOI Bot] 🎨 Applied Font 10 Tricolor Gradient to new server: ${guild.name}`);
    } catch (err) {
      console.warn(`[UOI Bot] Notice in new server handler ${guild.name}:`, err.message);
    }
  });

  // When removed from a server, retain configuration and cards permanently
  client.on('guildDelete', (guild) => {
    try {
      markServerLeft(guild.id);
      console.log(`[UOI Bot] 🧠 Preserved permanent memory for departed server: ${guild.name || guild.id}`);
    } catch (err) {
      console.warn('[UOI Bot] Notice on guildDelete:', err.message);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    // 1. Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'card') {
        try {
          await cardCommand.execute(interaction);
        } catch (err) {
          console.error('[UOI Bot] Error executing /card command:', err);
          const errMsg = 'There was an error executing this command on the server.';
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: errMsg, ephemeral: true });
          } else {
            await interaction.reply({ content: errMsg, ephemeral: true });
          }
        }
      }
      return;
    }

    // 2. Staff review button clicks (Accept / Decline)
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('card_')) {
        try {
          await cardCommand.handleButton(interaction);
        } catch (err) {
          console.error('[UOI Bot] Error handling button interaction:', err);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Error processing this request.', ephemeral: true });
          }
        }
      }
      return;
    }

    // 3. Modal submissions (Decline with Reason)
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('card_modal_')) {
        try {
          await cardCommand.handleModal(interaction);
        } catch (err) {
          console.error('[UOI Bot] Error handling modal interaction:', err);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Error processing rejection modal.', ephemeral: true });
          }
        }
      }
      return;
    }
  });

  client.login(token).catch((err) => {
    console.error('===============================================================');
    console.error('[UOI Bot] ❌ Discord login failed:', err.message);
    if (
      err.message.toLowerCase().includes('disallowed intents') ||
      err.message.toLowerCase().includes('privileged')
    ) {
      console.error('👉 ACTION REQUIRED: Enable "Server Members Intent"!');
      console.error('   1. Visit https://discord.com/developers/applications');
      console.error('   2. Select your Bot -> Click the "Bot" tab.');
      console.error('   3. Scroll to "Privileged Gateway Intents".');
      console.error('   4. Turn ON "Server Members Intent" and click "Save Changes".');
    } else if (
      err.message.toLowerCase().includes('token') ||
      err.message.toLowerCase().includes('401')
    ) {
      console.error('👉 ACTION REQUIRED: Check your DISCORD_TOKEN in the .env file.');
      console.error('   Make sure there are no quotes or extra spaces.');
    }
    console.error('===============================================================');
  });
}
