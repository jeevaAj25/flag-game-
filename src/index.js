// Main Entrypoint for Live Flag Count Fight
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createServer } = require('./server');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Ensure config exists
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('config.json not found! Please create it from config.json or .env.example');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

config.server = config.server || {};
config.youtube = config.youtube || {};
config.game = config.game || {};
config.stream = config.stream || {};

// Environment variable overrides (AWS / Docker / .env)
if (process.env.PORT) config.server.port = parseInt(process.env.PORT, 10);
if (process.env.STREAM_KEY) config.youtube.streamKey = process.env.STREAM_KEY;
if (process.env.YOUTUBE_VIDEO_ID) config.youtube.videoId = process.env.YOUTUBE_VIDEO_ID;
if (process.env.YOUTUBE_LIVE_CHAT_ID) config.youtube.liveChatId = process.env.YOUTUBE_LIVE_CHAT_ID;
if (process.env.YOUTUBE_API_KEY) config.youtube.apiKey = process.env.YOUTUBE_API_KEY;
if (process.env.GOOGLE_CLIENT_ID) config.youtube.clientId = process.env.GOOGLE_CLIENT_ID;
if (process.env.GOOGLE_CLIENT_SECRET) config.youtube.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (process.env.GOOGLE_REFRESH_TOKEN) config.youtube.refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
if (process.env.LIKE_MODE) config.game.likeMode = process.env.LIKE_MODE;
if (process.env.WATERMARK_TEXT) config.game.watermarkText = process.env.WATERMARK_TEXT;

const port = config.server.port || 3000;
const { server, youtube, simulator, streamer } = createServer(CONFIG_PATH);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${port} is already in use by another process!`);
    console.error(`👉 On Linux/AWS, run: fuser -k ${port}/tcp`);
    console.error(`👉 On Windows, run: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`);
    console.error(`👉 Or change the port via PORT=${port + 1} npm start\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// Graceful shutdown for AWS ECS / Docker / EC2 PM2
const shutdown = async (signal) => {
  console.log(`\n[App] Received ${signal}. Shutting down cleanly...`);
  try {
    if (youtube && youtube.stop) youtube.stop();
    if (simulator && simulator.stopTraffic) simulator.stopTraffic();
    if (streamer && streamer.stopStream) await streamer.stopStream();
    if (server) {
      server.close(() => {
        console.log('[App] Server stopped successfully.');
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000).unref();
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('[App] Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(port, () => {
  console.log(`
====================================================================
  🚩 LIVE FLAG COUNT FIGHT - YOUTUBE LIVE STREAM SCOREBOARD 🚩
====================================================================

  🎮 OBS Browser Source URL:
     http://localhost:${port}/overlay
     (Resolution: 1080 x 1920, 30/60 fps)

  🛠️  Interactive Admin Control Panel:
     http://localhost:${port}/admin

  📡 YouTube Poller Status:
     Video ID:    ${config.youtube.videoId || '(not set - configure in Admin or config.json)'}
     Live Chat ID:${config.youtube.liveChatId || '(auto-resolves from Video ID)'}
     API Key:     ${config.youtube.apiKey ? 'Configured (✓)' : '(not set)'}
     OAuth2:      ${config.youtube.clientId ? 'Configured (✓)' : '(not set)'}

  🎥 Direct RTMP Streamer:
     Target URL:  ${config.youtube.rtmpUrl}
     Stream Key:  ${config.youtube.streamKey ? 'Configured (✓)' : '(not set - enter in Admin)'}

  💡 Tip: Open the Admin Panel to run instant simulations,
     test Super Chats, control the round timer, or launch streaming!
====================================================================
  `);

  // Auto-start YouTube polling if credentials are provided
  if (config.youtube.apiKey || config.youtube.clientId) {
    if (config.youtube.videoId || config.youtube.liveChatId) {
      console.log('[App] Starting live YouTube polling automatically...');
      youtube.start();
    }
  }
});
