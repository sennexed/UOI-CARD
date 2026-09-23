import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { cardCommand, getCanvasEngineInfo } from './commands/card.js';
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
          'Cache-Control': 'no-cache',
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        status: 'online',
        service: 'Union of Indians (UOI) Discord Bot',
        botReady: !!(globalThis.__uoiBotClient && globalThis.__uoiBotClient.isReady()),
        uptimeSeconds: Math.floor(process.uptime()),
        canvasEngine: canvasInfo,
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

  // Serve static HTML status dashboard
  try {
    const htmlPath = path.join(process.cwd(), 'index.html');
    if (fs.existsSync(htmlPath)) {
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(htmlContent);
    }
  } catch (_) {}

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

  client.once('ready', async () => {
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

    // Apply Font 10 (Sinistre Vampyre) with Orange, White & Green Gradient Style across all servers
    try {
      console.log('[UOI Bot] 🎨 Applying Font 10 (Sinistre) with Orange, White & Green Gradient...');
      const guilds = await client.guilds.fetch();
      for (const [guildId, oauthGuild] of guilds) {
        try {
          // Attempt with 3 colors: Orange, White, Green
          await rest.patch(`/guilds/${guildId}/members/@me`, {
            body: {
              display_name_font_id: 10,        // 10th Font: Sinistre (Vampyre / Gothic)
              display_name_effect_id: 2,      // Gradient effect
              display_name_colors: [0xff9933, 0xffffff, 0x138808], // Orange (#FF9933), White (#FFFFFF), Green (#138808)
            },
          });
          console.log(`[UOI Bot] 🎨 Applied Font 10 Tricolor Gradient to: ${oauthGuild.name} (${guildId})`);
        } catch (firstErr) {
          // If Discord API strictly restricts gradient array to max 2 items, fall back to Orange & Green
          try {
            await rest.patch(`/guilds/${guildId}/members/@me`, {
              body: {
                display_name_font_id: 10,
                display_name_effect_id: 2,
                display_name_colors: [0xff9933, 0x138808], // Orange & Green
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
            display_name_colors: [0xff9933, 0xffffff, 0x138808], // Orange, White, Green
          },
        });
      } catch (_) {
        await rest.patch(`/guilds/${guild.id}/members/@me`, {
          body: {
            display_name_font_id: 10,
            display_name_effect_id: 2,
            display_name_colors: [0xff9933, 0x138808],
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
