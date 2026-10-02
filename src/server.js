// Web & WebSocket Server for Live Flag Count Fight
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const EventEmitter = require('events');

const db = require('./db');
const YouTubeService = require('./youtube');
const Simulator = require('./simulator');
const StreamerService = require('./streamer');
const BoostManager = require('./boost');

function createServer(configPath) {
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  db.setConfig(config);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });
  const eventEmitter = new EventEmitter();

  function broadcast(data) {
    const json = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }

  // Boost Manager (Automatic 2X Boost frenzy every 10 min)
  const boost = new BoostManager(config, eventEmitter, broadcast);

  // Sub-services with 2X boost multiplier
  const youtube = new YouTubeService(config, eventEmitter, {
    getMultiplier: () => boost.getMultiplier()
  });
  const simulator = new Simulator(config, eventEmitter, {
    getMultiplier: () => boost.getMultiplier()
  });
  const streamer = new StreamerService(config, eventEmitter);

  // Round Timer State
  let roundTimer = null;
  let roundRemainingSeconds = 0;
  let roundActive = false;
  let currentWinner = null;

  // Hook Event Emitters to WebSocket Broadcasts
  eventEmitter.on('event', (evt) => {
    broadcast({ type: 'ACTIVITY_EVENT', data: evt });
  });

  eventEmitter.on('scores_update', (countries) => {
    broadcast({ type: 'SCORES_UPDATE', data: countries });
  });

  eventEmitter.on('superchat_update', (donors) => {
    const currentGoalStr = db.getSetting('currentGoalAmount', String(config.game?.currentGoalAmount || '3.08'));
    const targetGoalStr = db.getSetting('goalAmount', String(config.game?.goalAmount || '50.00'));
    broadcast({ type: 'SUPERCHAT_UPDATE', data: donors });
    broadcast({
      type: 'GOAL_UPDATE',
      data: { current: parseFloat(currentGoalStr), target: parseFloat(targetGoalStr) }
    });
  });

  eventEmitter.on('stream_status', (status) => {
    broadcast({ type: 'STREAM_STATUS', data: status });
  });

  // Client connection handler
  wss.on('connection', (ws) => {
    const currentGoalStr = db.getSetting('currentGoalAmount', String(config.game?.currentGoalAmount || '3.08'));
    const targetGoalStr = db.getSetting('goalAmount', String(config.game?.goalAmount || '50.00'));

    ws.send(JSON.stringify({
      type: 'INIT',
      data: {
        countries: db.getCountries(),
        topDonors: db.getTopDonors(2),
        goal: {
          current: parseFloat(currentGoalStr),
          target: parseFloat(targetGoalStr)
        },
        boost: boost.getStatus(),
        settings: {
          likeMode: config.game?.likeMode || 'active_split'
        },
        audio: {
          bgmEnabled: config.audio?.bgmEnabled !== false,
          bgmFile: config.audio?.bgmFile || '/sounds/bgm.mp3',
          bgmVolume: config.audio?.bgmVolume ?? 0.7,
          bgmTrackName: config.audio?.bgmTrackName || 'Extan - I Want To Live'
        },
        levels: {
          pointsPerLevel: config.points?.pointsPerLevel || { 1: 1, 2: 5, 3: 10, 4: 15, 5: 20 }
        },
        round: {
          active: roundActive,
          remainingSeconds: roundRemainingSeconds,
          winner: currentWinner
        }
      }
    }));
  });

  // AWS / Production Healthcheck Endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Serve Routes
  app.get('/overlay', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'overlay.html'));
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  });

  // Google OAuth2 callback endpoint
  app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Authorization code missing.');
    }

    try {
      if (youtube.oauth2Client) {
        const { tokens } = await youtube.oauth2Client.getToken(code);
        console.log('[OAuth2] Received tokens! Refresh token:', tokens.refresh_token);
        if (tokens.refresh_token) {
          config.youtube.refreshToken = tokens.refresh_token;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        }
        res.send('<h2>OAuth2 Authorization Successful!</h2><p>You can close this tab and return to the Admin Panel.</p>');
      } else {
        res.send('OAuth2 client not initialized. Check clientId & clientSecret in config.json.');
      }
    } catch (err) {
      res.status(500).send('Error exchanging OAuth2 code: ' + err.message);
    }
  });

  // REST API Endpoints for Admin Panel
  app.get('/api/state', (req, res) => {
    const currentGoalStr = db.getSetting('currentGoalAmount', String(config.game?.currentGoalAmount || '3.08'));
    const targetGoalStr = db.getSetting('goalAmount', String(config.game?.goalAmount || '50.00'));

    res.json({
      countries: db.getCountries(),
      topDonors: db.getTopDonors(2),
      goal: {
        current: parseFloat(currentGoalStr),
        target: parseFloat(targetGoalStr)
      },
      boost: boost.getStatus(),
      settings: {
        likeMode: config.game?.likeMode || 'active_split'
      },
      audio: {
        bgmEnabled: config.audio?.bgmEnabled !== false,
        bgmFile: config.audio?.bgmFile || '/sounds/bgm.mp3',
        bgmVolume: config.audio?.bgmVolume ?? 0.7,
        bgmTrackName: config.audio?.bgmTrackName || 'Extan - I Want To Live'
      },
      levels: {
        pointsPerLevel: config.points?.pointsPerLevel || { 1: 1, 2: 5, 3: 10, 4: 15, 5: 20 }
      },
      stream: streamer.getStatus(),
      simulatorRunning: simulator.isRunning,
      youtube: {
        videoId: config.youtube?.videoId || '',
        streamKey: config.youtube?.streamKey || '',
        apiKey: config.youtube?.apiKey || '',
        backupApiKey: config.youtube?.backupApiKey || '',
        hasStreamKey: Boolean(config.youtube?.streamKey),
        hasApiKey: Boolean(config.youtube?.apiKey),
        hasBackupApiKey: Boolean(config.youtube?.backupApiKey),
        activeKeyIndex: youtube?.activeKeyIndex || 1,
        running: Boolean(youtube?.isRunning)
      },
      round: {
        active: roundActive,
        remainingSeconds: roundRemainingSeconds,
        winner: currentWinner
      }
    });
  });

  app.post('/api/admin/points', (req, res) => {
    const { code, points, chatterName, applyMultiplier } = req.body;
    if (!code || typeof points !== 'number') {
      return res.status(400).json({ error: 'Code and points required' });
    }
    const mult = (applyMultiplier !== false && boost.active) ? boost.getMultiplier() : 1;
    const finalPoints = points * mult;
    const result = db.addPoints(code, finalPoints, chatterName || 'Admin', Boolean(chatterName));
    if (!result) return res.status(404).json({ error: 'Country not found' });

    eventEmitter.emit('event', {
      type: 'chat',
      user: chatterName || 'Admin',
      level: 5,
      country: result.name,
      code: result.code,
      points: finalPoints,
      isBonus: Math.abs(finalPoints) > 10,
      is2x: mult > 1,
      multiplier: mult
    });
    eventEmitter.emit('scores_update', db.getCountries());
    res.json({ success: true, country: result, points: finalPoints });
  });

  app.post('/api/admin/reset', (req, res) => {
    db.resetScores(true);
    eventEmitter.emit('scores_update', db.getCountries());
    res.json({ success: true });
  });

  app.post('/api/admin/goal', (req, res) => {
    const { target, current } = req.body;
    if (typeof target === 'number') {
      db.setSetting('goalAmount', target.toFixed(2));
    }
    if (typeof current === 'number') {
      db.setSetting('currentGoalAmount', current.toFixed(2));
    }
    const currentGoalStr = db.getSetting('currentGoalAmount', '3.08');
    const targetGoalStr = db.getSetting('goalAmount', '50.00');

    broadcast({
      type: 'GOAL_UPDATE',
      data: { current: parseFloat(currentGoalStr), target: parseFloat(targetGoalStr) }
    });
    res.json({ success: true });
  });

  // Boost Controls (2X boost every 10 min)
  app.get('/api/admin/boost', (req, res) => {
    res.json(boost.getStatus());
  });

  app.post('/api/admin/boost/trigger', (req, res) => {
    const duration = parseInt(req.body.duration || boost.durationSeconds, 10);
    boost.triggerBoost(duration);
    res.json({ success: true, boost: boost.getStatus() });
  });

  app.post('/api/admin/boost/stop', (req, res) => {
    boost.endBoost();
    res.json({ success: true, boost: boost.getStatus() });
  });

  app.post('/api/admin/boost/config', (req, res) => {
    const { intervalMinutes, durationSeconds, autoEnabled, multiplier } = req.body;
    boost.updateConfig({ intervalMinutes, durationSeconds, autoEnabled, multiplier });
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {}
    res.json({ success: true, boost: boost.getStatus() });
  });

  app.post('/api/admin/boost/double-scores', (req, res) => {
    const updatedCountries = db.doubleAllScores();
    broadcast({ type: 'SCORES_UPDATE', data: updatedCountries });
    broadcast({
      type: 'ACTIVITY_EVENT',
      data: {
        type: 'boost',
        user: 'ADMIN',
        country: 'ALL COUNTRIES',
        points: '2X SCORES DOUBLED',
        isBonus: true,
        is2x: true,
        message: '💥 ALL COUNTRY SCORES HAVE BEEN DOUBLED (2X)! 💥'
      }
    });
    res.json({ success: true, countries: updatedCountries });
  });

  // YouTube API Key tester (Primary or Backup)
  app.post('/api/admin/youtube/test', async (req, res) => {
    const isBackup = req.body.keyType === 'backup';
    const key = req.body.apiKey || (isBackup ? config.youtube?.backupApiKey : config.youtube?.apiKey);
    if (!key) {
      return res.status(400).json({ error: `Please enter a YouTube ${isBackup ? 'Backup ' : 'Primary '}API Key to test` });
    }
    try {
      const { google } = require('googleapis');
      const yt = google.youtube({ version: 'v3', auth: key });
      const videoId = req.body.videoId || config.youtube?.videoId || 'dQw4w9WgXcQ';
      await yt.videos.list({
        part: ['snippet'],
        id: [videoId]
      });
      res.json({ success: true, message: `YouTube ${isBackup ? 'Backup ' : 'Primary '}API Key is valid and working!` });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      res.status(400).json({ success: false, error: msg });
    }
  });

  // Round Management
  function startRound(durationMinutes) {
    if (roundTimer) clearInterval(roundTimer);
    roundRemainingSeconds = durationMinutes * 60;
    roundActive = true;
    currentWinner = null;

    broadcast({
      type: 'ROUND_STATUS',
      data: { active: true, remainingSeconds: roundRemainingSeconds, winner: null }
    });

    roundTimer = setInterval(() => {
      roundRemainingSeconds--;
      if (roundRemainingSeconds <= 0) {
        endRound();
      } else {
        broadcast({
          type: 'ROUND_STATUS',
          data: { active: true, remainingSeconds: roundRemainingSeconds, winner: null }
        });
      }
    }, 1000);
  }

  function endRound() {
    if (roundTimer) clearInterval(roundTimer);
    roundActive = false;
    roundRemainingSeconds = 0;

    const top = db.getCountries()[0];
    currentWinner = top;

    broadcast({
      type: 'ROUND_STATUS',
      data: { active: false, remainingSeconds: 0, winner: top, autoResetIn: 30 }
    });

    // Auto reset / start next round after 30 seconds
    setTimeout(() => {
      currentWinner = null;
      broadcast({
        type: 'ROUND_STATUS',
        data: { active: false, remainingSeconds: 0, winner: null }
      });
    }, 30000);
  }

  app.post('/api/admin/round/start', (req, res) => {
    const minutes = parseInt(req.body.durationMinutes || 10, 10);
    startRound(minutes);
    res.json({ success: true, remainingSeconds: roundRemainingSeconds });
  });

  app.post('/api/admin/round/end', (req, res) => {
    endRound();
    res.json({ success: true, winner: currentWinner });
  });

  // Simulator Controls
  app.post('/api/admin/simulate/chat', (req, res) => {
    const { country, user, level } = req.body;
    simulator.simulateChat(user ? { name: user, defaultCountry: country || 'id' } : null, country, level);
    res.json({ success: true });
  });

  app.post('/api/admin/simulate/superchat', (req, res) => {
    const { usd, country, user } = req.body;
    simulator.simulateSuperchat(usd || 2.67, user ? { name: user, defaultCountry: country || 'sa' } : null, country);
    res.json({ success: true });
  });

  app.post('/api/admin/simulate/like', (req, res) => {
    const { count } = req.body;
    simulator.simulateLike(count || 1);
    res.json({ success: true });
  });

  app.post('/api/admin/simulate/subscribe', (req, res) => {
    simulator.simulateSubscribe();
    res.json({ success: true });
  });

  app.post('/api/admin/simulate/traffic', (req, res) => {
    const { action } = req.body;
    if (action === 'start') {
      simulator.startTraffic(req.body.intervalMs || 1000);
    } else {
      simulator.stopTraffic();
    }
    res.json({ success: true, running: simulator.isRunning });
  });

  // Audio settings endpoint
  app.post('/api/admin/audio', (req, res) => {
    const { enabled, volume } = req.body;
    if (!config.audio) config.audio = {};
    if (enabled !== undefined) config.audio.bgmEnabled = Boolean(enabled);
    if (volume !== undefined) config.audio.bgmVolume = parseFloat(volume);

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      broadcast({
        type: 'AUDIO_UPDATE',
        data: {
          bgmEnabled: config.audio.bgmEnabled,
          bgmVolume: config.audio.bgmVolume,
          bgmFile: config.audio.bgmFile || '/sounds/bgm.mp3',
          bgmTrackName: config.audio.bgmTrackName || 'Extan - I Want To Live'
        }
      });
      res.json({ success: true, audio: config.audio });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write config: ' + e.message });
    }
  });

  // Update configuration endpoint
  app.post('/api/admin/config', (req, res) => {
    const { streamKey, videoId, apiKey, backupApiKey, fps, bitrate } = req.body;
    if (!config.youtube) config.youtube = {};
    if (typeof streamKey === 'string' && streamKey.trim() !== '') config.youtube.streamKey = streamKey.trim();
    if (typeof videoId === 'string') config.youtube.videoId = videoId.trim();
    if (typeof apiKey === 'string' && apiKey.trim() !== '') config.youtube.apiKey = apiKey.trim();
    if (typeof backupApiKey === 'string' && backupApiKey.trim() !== '') config.youtube.backupApiKey = backupApiKey.trim();
    if (fps !== undefined) config.stream.fps = parseInt(fps, 10) || 30;
    if (bitrate !== undefined) config.stream.bitrate = bitrate;

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      db.setConfig(config);
      youtube.updateConfig(config);
      streamer.config = config;

      // If YouTube API Key & Video ID are provided, ensure YouTube poller is active
      if ((config.youtube.apiKey || config.youtube.backupApiKey || config.youtube.clientId) && config.youtube.videoId) {
        if (!youtube.isRunning) {
          console.log('[App] Starting live YouTube polling with updated credentials...');
          youtube.start();
        }
      }

      res.json({
        success: true,
        message: 'Settings saved successfully',
        youtube: {
          videoId: config.youtube.videoId || '',
          streamKey: config.youtube.streamKey || '',
          apiKey: config.youtube.apiKey || '',
          backupApiKey: config.youtube.backupApiKey || '',
          hasStreamKey: Boolean(config.youtube.streamKey),
          hasApiKey: Boolean(config.youtube.apiKey),
          hasBackupApiKey: Boolean(config.youtube.backupApiKey),
          activeKeyIndex: youtube?.activeKeyIndex || 1,
          running: Boolean(youtube?.isRunning)
        }
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write config: ' + e.message });
    }
  });

  // RTMP Streamer Controls
  app.post('/api/admin/stream', async (req, res) => {
    const { action, streamKey } = req.body;
    try {
      if (action === 'start') {
        const key = streamKey || config.youtube?.streamKey;
        if (!key) {
          return res.status(400).json({ error: 'Please enter a YouTube Stream Key' });
        }
        if (streamKey && streamKey !== config.youtube.streamKey) {
          config.youtube.streamKey = streamKey;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        }

        await streamer.startStream(key);

        // Auto-start YouTube chat polling if videoId is set
        if (config.youtube.videoId && !youtube.isRunning) {
          youtube.start();
        }

        res.json({ success: true, message: 'Stream started' });
      } else {
        await streamer.stopStream();
        res.json({ success: true, message: 'Stream stopped' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/stream/status', (req, res) => {
    res.json(streamer.getStatus());
  });

  return { app, server, youtube, simulator, streamer, boost, config };
}

module.exports = { createServer };
