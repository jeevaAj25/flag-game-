// YouTube Data API v3 Live Integration Service
// Handles: Live Chat polling, Super Chats, Subscribers, Video Likes, Quota Backoff

const { google } = require('googleapis');
const { detectCountry } = require('./countries');
const { superChatMicrosToUsd } = require('./currency');
const db = require('./db');

class YouTubeService {
  constructor(config, eventEmitter) {
    this.config = config;
    this.emitter = eventEmitter;
    this.isRunning = false;

    this.liveChatId = config.youtube.liveChatId || '';
    this.videoId = config.youtube.videoId || '';
    this.apiKey = config.youtube.apiKey || '';
    this.nextPageToken = null;

    this.previousLikeCount = null;
    this.pollingIntervalMs = 3500;
    this.backoffMs = 0;

    this.chatTimer = null;
    this.likeTimer = null;
    this.subTimer = null;

    this.lastChatterCountry = null;

    // OAuth2 client setup
    this.oauth2Client = null;
    if (config.youtube.clientId && config.youtube.clientSecret) {
      this.oauth2Client = new google.auth.OAuth2(
        config.youtube.clientId,
        config.youtube.clientSecret,
        config.youtube.redirectUri || 'http://localhost:3000/oauth2callback'
      );

      if (config.youtube.refreshToken) {
        this.oauth2Client.setCredentials({
          refresh_token: config.youtube.refreshToken
        });
      }
    }
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.youtube) {
      this.liveChatId = newConfig.youtube.liveChatId || this.liveChatId;
      this.videoId = newConfig.youtube.videoId || this.videoId;
      this.apiKey = newConfig.youtube.apiKey || this.apiKey;
    }
  }

  async start() {
    if (this.isRunning) return;
    if (!this.apiKey && !this.oauth2Client) {
      console.warn('[YouTube] Warning: Neither YouTube API Key nor OAuth2 credentials are configured.');
      console.warn('[YouTube] Please provide a YouTube Data API v3 API Key in config.json or Admin Panel to enable live polling.');
      return;
    }
    this.isRunning = true;
    console.log('[YouTube] Starting YouTube poller...');

    // If liveChatId is empty but videoId is present, resolve liveChatId
    if (!this.liveChatId && this.videoId) {
      await this.resolveLiveChatId();
    }

    this.pollChat();
    this.pollLikes();
    this.pollSubscribers();
  }

  stop() {
    this.isRunning = false;
    if (this.chatTimer) clearTimeout(this.chatTimer);
    if (this.likeTimer) clearTimeout(this.likeTimer);
    if (this.subTimer) clearTimeout(this.subTimer);
    console.log('[YouTube] Stopped YouTube poller.');
  }

  async resolveLiveChatId() {
    try {
      const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client || this.apiKey });
      const res = await youtube.videos.list({
        part: ['liveStreamingDetails'],
        id: [this.videoId]
      });

      if (res.data.items && res.data.items.length > 0) {
        const details = res.data.items[0].liveStreamingDetails;
        if (details && details.activeLiveChatId) {
          this.liveChatId = details.activeLiveChatId;
          console.log('[YouTube] Resolved activeLiveChatId:', this.liveChatId);
        }
      }
    } catch (err) {
      console.warn('[YouTube] Could not resolve liveChatId from videoId:', err.message);
    }
  }

  // 1. LIVE CHAT & SUPER CHATS POLLING
  async pollChat() {
    if (!this.isRunning) return;

    if (!this.liveChatId) {
      // Recheck in 10s if we don't have chat ID yet
      this.chatTimer = setTimeout(() => this.pollChat(), 10000);
      return;
    }

    try {
      const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client || this.apiKey });
      const params = {
        liveChatId: this.liveChatId,
        part: ['snippet', 'authorDetails']
      };
      if (this.nextPageToken) {
        params.pageToken = this.nextPageToken;
      }

      const res = await youtube.liveChatMessages.list(params);

      // YouTube API recommends pollingIntervalMillis
      if (res.data.pollingIntervalMillis) {
        this.pollingIntervalMs = Math.max(2000, res.data.pollingIntervalMillis);
      }
      this.nextPageToken = res.data.nextPageToken;
      this.backoffMs = 0; // Reset backoff on success

      if (res.data.items && res.data.items.length > 0) {
        for (const item of res.data.items) {
          this.processChatMessage(item);
        }
      }
    } catch (err) {
      console.warn('[YouTube Chat] Polling error:', err.message);
      // Exponential backoff up to 30 seconds
      this.backoffMs = Math.min(30000, (this.backoffMs || 2000) * 1.5);
    }

    const nextDelay = this.backoffMs > 0 ? this.backoffMs : this.pollingIntervalMs;
    this.chatTimer = setTimeout(() => this.pollChat(), nextDelay);
  }

  processChatMessage(item) {
    const messageId = item.id;
    if (db.isEventProcessed(messageId)) {
      return; // Deduplicate
    }
    db.markEventProcessed(messageId, 'chat');

    const snippet = item.snippet;
    const author = item.authorDetails || {};
    const channelId = author.channelId || 'unknown_author';
    const displayName = author.displayName || 'Viewer';
    const avatarUrl = author.profileImageUrl || '';

    // A. Check for Super Chat / Super Sticker
    if (snippet.type === 'superChatEvent' || snippet.type === 'superStickerEvent') {
      const details = snippet.superChatDetails || snippet.superStickerDetails || {};
      const amountMicros = details.amountMicros || 0;
      const currency = details.currency || 'USD';
      const comment = details.userComment || '';

      const usdAmount = superChatMicrosToUsd(amountMicros, currency);
      const pointsPerUsd = this.config.points?.pointsPerUsd || 4000;
      const points = Math.max(1, Math.round(usdAmount * pointsPerUsd));

      // Country detection: check comment text first, then user's previous country, or default to top country
      let country = detectCountry(comment);
      if (!country) {
        const user = db.getUser(channelId);
        if (user && user.last_country) {
          country = db.getCountry(user.last_country);
        }
      }
      if (!country) {
        const topCountries = db.getCountries();
        country = topCountries[0] || { code: 'id', name: 'Indonesia' };
      }

      // Add points to country
      db.addPoints(country.code, points, displayName, true);

      // Record in Superchat Donors
      const topDonors = db.recordSuperchat(
        channelId,
        displayName,
        avatarUrl,
        country.code,
        country.name,
        usdAmount,
        points
      );

      this.lastChatterCountry = country;

      // Broadcast Activity Event & Leaderboards
      this.emitter.emit('event', {
        type: 'superchat',
        user: displayName,
        country: country.name,
        code: country.code,
        points: points,
        usd: usdAmount,
        avatar: avatarUrl,
        isBonus: true
      });

      this.emitter.emit('superchat_update', topDonors);
      this.emitter.emit('scores_update', db.getCountries());
      return;
    }

    // B. Standard Text Chat Message
    const text = snippet.displayMessage || snippet.textMessageDetails?.messageText || '';
    const country = detectCountry(text);
    if (!country) {
      return; // Ignore messages not matching any country
    }

    const cooldownMs = this.config.game?.chatCooldownMs || 3000;
    const maxPerMin = this.config.game?.maxChatsPerMin || 20;

    const chatResult = db.recordUserChat(channelId, displayName, avatarUrl, country.code, cooldownMs, maxPerMin);
    if (!chatResult.allowed) {
      return; // Hit anti-spam rate limit
    }

    const basePoints = chatResult.pointsEarned || this.config.points?.pointsPerChat || 1;
    let earnedPoints = basePoints;

    // Check if user had pending subscriber reward
    const pendingPoints = db.claimPendingSubscriber(channelId);
    if (pendingPoints > 0) {
      earnedPoints += pendingPoints;
      db.addPointsToUser(channelId, pendingPoints);
    }

    db.addPoints(country.code, earnedPoints, displayName, true);
    this.lastChatterCountry = country;

    // Emit event for scoreboard banner
    this.emitter.emit('event', {
      type: 'chat',
      user: displayName,
      level: chatResult.oldLevel || chatResult.level || 1,
      country: country.name,
      code: country.code,
      points: earnedPoints,
      avatar: avatarUrl,
      isBonus: earnedPoints > 1
    });

    this.emitter.emit('scores_update', db.getCountries());
  }

  // 2. VIDEO LIKES POLLING
  async pollLikes() {
    if (!this.isRunning) return;

    if (this.videoId) {
      try {
        const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client || this.apiKey });
        const res = await youtube.videos.list({
          part: ['statistics'],
          id: [this.videoId]
        });

        if (res.data.items && res.data.items.length > 0) {
          const stats = res.data.items[0].statistics;
          const currentLikes = parseInt(stats.likeCount || '0', 10);

          if (this.previousLikeCount !== null && currentLikes > this.previousLikeCount) {
            const deltaLikes = currentLikes - this.previousLikeCount;
            this.handleLikeDelta(deltaLikes);
          }
          this.previousLikeCount = currentLikes;
        }
      } catch (err) {
        console.warn('[YouTube Likes] Polling error:', err.message);
      }
    }

    this.likeTimer = setTimeout(() => this.pollLikes(), 10000);
  }

  handleLikeDelta(delta) {
    if (delta <= 0) return;
    const pointsPerLike = this.config.points?.pointsPerLike || 400;
    const totalPoints = delta * pointsPerLike;
    const likeMode = this.config.game?.likeMode || 'active_split';

    console.log(`[YouTube] Detected +${delta} new likes! Distributing ${totalPoints} points using mode '${likeMode}'`);

    if (likeMode === 'top_country') {
      const topCountries = db.getCountries();
      const top = topCountries[0];
      if (top) {
        db.addPoints(top.code, totalPoints);
        this.emitter.emit('event', {
          type: 'like',
          country: top.name,
          code: top.code,
          points: totalPoints,
          user: 'Stream Likes'
        });
      }
    } else if (likeMode === 'last_chatter' && this.lastChatterCountry) {
      db.addPoints(this.lastChatterCountry.code, totalPoints);
      this.emitter.emit('event', {
        type: 'like',
        country: this.lastChatterCountry.name,
        code: this.lastChatterCountry.code,
        points: totalPoints,
        user: 'Stream Likes'
      });
    } else {
      // 'active_split': share across countries active in the last 60 seconds
      const activeCountries = db.getRecentCountryActivity(60);
      if (activeCountries.length > 0) {
        const totalActivity = activeCountries.reduce((sum, item) => sum + item.count, 0);
        for (const act of activeCountries) {
          const country = db.getCountry(act.country_code);
          if (country) {
            const countryPoints = Math.max(1, Math.round((act.count / totalActivity) * totalPoints));
            db.addPoints(country.code, countryPoints);
            this.emitter.emit('event', {
              type: 'like',
              country: country.name,
              code: country.code,
              points: countryPoints,
              user: 'Stream Likes'
            });
          }
        }
      } else {
        // Fallback to top country
        const top = db.getCountries()[0];
        if (top) {
          db.addPoints(top.code, totalPoints);
          this.emitter.emit('event', {
            type: 'like',
            country: top.name,
            code: top.code,
            points: totalPoints,
            user: 'Stream Likes'
          });
        }
      }
    }

    this.emitter.emit('scores_update', db.getCountries());
  }

  // 3. SUBSCRIBERS POLLING
  async pollSubscribers() {
    if (!this.isRunning) return;

    if (this.oauth2Client && this.config.youtube.refreshToken) {
      try {
        const youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
        const res = await youtube.subscriptions.list({
          part: ['subscriberSnippet'],
          mySubscribers: true,
          maxResults: 20
        });

        if (res.data.items && res.data.items.length > 0) {
          const pointsPerSub = this.config.points?.pointsPerSubscribe || 400;

          for (const item of res.data.items) {
            const subId = item.id;
            if (db.isEventProcessed(subId)) continue;
            db.markEventProcessed(subId, 'subscriber');

            const subscriber = item.subscriberSnippet;
            const channelId = subscriber.channelId;
            const title = subscriber.title || 'New Subscriber';

            // Check if this subscriber is a known chatter
            const user = db.getUser(channelId);
            if (user && user.last_country) {
              const country = db.getCountry(user.last_country);
              if (country) {
                db.addPoints(country.code, pointsPerSub, title, true);
                this.emitter.emit('event', {
                  type: 'subscribe',
                  user: title,
                  country: country.name,
                  code: country.code,
                  points: pointsPerSub,
                  level: user.level || 1
                });
              }
            } else {
              // Place into pending pool awaiting country message
              db.addPendingSubscriber(channelId, title, pointsPerSub);
            }
          }
        }
      } catch (err) {
        console.warn('[YouTube Subs] Polling error (requires authenticated OAuth token):', err.message);
      }
    }

    // Cleanup expired pending subscribers (> 10 min) and give remainder to #1 country
    const expired = db.cleanupPendingSubscribers(600);
    if (expired && expired.length > 0) {
      const top = db.getCountries()[0];
      if (top) {
        const leftoverPoints = expired.reduce((sum, item) => sum + item.points, 0);
        db.addPoints(top.code, leftoverPoints);
        this.emitter.emit('scores_update', db.getCountries());
      }
    }

    this.subTimer = setTimeout(() => this.pollSubscribers(), 25000);
  }
}

module.exports = YouTubeService;
