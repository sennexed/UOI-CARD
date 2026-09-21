import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import http from 'http';
import { cardCommand } from './commands/card.js';

// 1. Lightweight HTTP Healthcheck server for Pterodactyl / WispByte container monitor
const PORT = process.env.PORT || 3000;
const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'online',
      service: 'Union of Indians (UOI) Discord Bot',
      botReady: !!(globalThis.__uoiBotClient && globalThis.__uoiBotClient.isReady()),
      uptimeSeconds: Math.floor(process.uptime()),
    })
  );
});

healthServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[UOI Bot] Note: Port ${PORT} is occupied, running in background bot mode.`);
  } else {
    console.warn('[UOI Bot] HTTP Server notice:', err.message);
  }
});

healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[UOI Bot] 🌐 Healthcheck listener active on port ${PORT}`);
});

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
