// YouTube Data API v3 Live Integration Service
// Handles: Live Chat polling, Super Chats, Subscribers, Video Likes, Quota Backoff

const { google } = require('googleapis');
const { detectCountry } = require('./countries');
const { superChatMicrosToUsd } = require('./currency');
const db = require('./db');

class YouTubeService {
  constructor(config, eventEmitter, options = {}) {
    this.config = config;
    this.emitter = eventEmitter;
    this.getMultiplier = typeof options.getMultiplier === 'function' ? options.getMultiplier : (() => 1);
    this.isRunning = false;
    this.quotaExhausted = false;

    this.liveChatId = config.youtube?.liveChatId || '';
    this.videoId = config.youtube?.videoId || '';
    this.apiKey = config.youtube?.apiKey || '';
    this.backupApiKey = config.youtube?.backupApiKey || '';
    this.activeKeyIndex = 1; // 1 = Primary, 2 = Backup

    this.nextPageToken = null;
    this.previousLikeCount = null;
    this.pollingIntervalMs = 10000; // Target ~10 seconds
    this.backoffMs = 0;

    this.isPollingChat = false;
    this.isPollingLikes = false;
    this.chatTimer = null;
    this.likeTimer = null;
    this.subTimer = null;

    this.lastChatterCountry = null;

    // OAuth2 client setup
    this.oauth2Client = null;
    if (config.youtube?.clientId && config.youtube?.clientSecret) {
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

  getActiveKey() {
    if (this.activeKeyIndex === 2 && this.backupApiKey) {
      return this.backupApiKey;
    }
    return this.apiKey;
  }

  getYouTubeClient() {
    const auth = this.oauth2Client || this.getActiveKey();
    return google.youtube({ version: 'v3', auth });
  }

  switchKeyOnQuotaExceeded() {
    if (this.activeKeyIndex === 1 && this.backupApiKey) {
      this.activeKeyIndex = 2;
      console.log('[YouTube] 🔄 Quota exceeded on Primary API Key! Successfully switched to Backup API Key.');
      this.emitter.emit('event', {
        type: 'system',
        user: 'SYSTEM',
        message: '🔄 Switched to Backup YouTube API Key due to quota limit.'
      });
      return true;
    }
    return false;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.youtube) {
      this.liveChatId = newConfig.youtube.liveChatId || this.liveChatId;
      this.videoId = newConfig.youtube.videoId || this.videoId;
      if (newConfig.youtube.apiKey !== undefined) this.apiKey = newConfig.youtube.apiKey;
      if (newConfig.youtube.backupApiKey !== undefined) this.backupApiKey = newConfig.youtube.backupApiKey;
      // Reset key rotation and quota state if new credentials were saved
      this.activeKeyIndex = 1;
      this.quotaExhausted = false;
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('[YouTube] Poller is already running. Ignoring duplicate start request.');
      return;
    }

    const currentKey = this.getActiveKey();
    if (!currentKey && !this.oauth2Client) {
      console.warn('[YouTube] Warning: Neither YouTube API Key nor OAuth2 credentials are configured.');
      console.warn('[YouTube] Please provide a YouTube Data API v3 API Key in Admin Panel or config.json.');
      return;
    }

    this.isRunning = true;
    this.quotaExhausted = false;

    // Clear any dangling timers to guarantee strictly ONE active polling loop
    if (this.chatTimer) clearTimeout(this.chatTimer);
    if (this.likeTimer) clearTimeout(this.likeTimer);
    if (this.subTimer) clearTimeout(this.subTimer);
    this.chatTimer = null;
    this.likeTimer = null;
    this.subTimer = null;

    console.log('[YouTube] Starting YouTube poller (Target: 2 requests every 10 seconds)...');

    // 1. Resolve liveChatId if needed (caches to avoid repeat requests)
    if (!this.liveChatId && this.videoId) {
      await this.resolveLiveChatId();
    }

    // 2. Start the TWO specified live operations:
    // Operation 1: Live Chat & Superchats
    this.pollChat();
    // Operation 2: Video Likes
    this.pollLikes();
    // Note: pollSubscribers is intentionally NOT started to keep requests strictly to TWO operations every 10s
  }

  stop() {
    this.isRunning = false;
    this.isPollingChat = false;
    this.isPollingLikes = false;
    if (this.chatTimer) {
      clearTimeout(this.chatTimer);
      this.chatTimer = null;
    }
    if (this.likeTimer) {
      clearTimeout(this.likeTimer);
      this.likeTimer = null;
    }
    if (this.subTimer) {
      clearTimeout(this.subTimer);
      this.subTimer = null;
    }
    console.log('[YouTube] Stopped YouTube poller.');
  }

  async resolveLiveChatId() {
    // If already cached in config/memory, reuse it without making an API call!
    if (this.liveChatId) return this.liveChatId;

    try {
      console.log('[YouTube] Resolving active liveChatId for video:', this.videoId);
      const youtube = this.getYouTubeClient();
      const res = await youtube.videos.list({
        part: ['liveStreamingDetails'],
        id: [this.videoId]
      });

      if (res.data.items && res.data.items.length > 0) {
        const details = res.data.items[0].liveStreamingDetails;
        if (details && details.activeLiveChatId) {
          this.liveChatId = details.activeLiveChatId;
          this.config.youtube.liveChatId = this.liveChatId;
          console.log('[YouTube] Resolved activeLiveChatId:', this.liveChatId);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      console.warn('[YouTube] Could not resolve liveChatId from videoId:', msg);
    }
    return this.liveChatId;
  }

  // 1. LIVE CHAT & SUPER CHATS POLLING (Operation 1)
  async pollChat() {
    if (!this.isRunning || this.quotaExhausted) return;

    // Enforce SINGLE polling loop
    if (this.isPollingChat) {
      return;
    }
    this.isPollingChat = true;

    if (this.chatTimer) {
      clearTimeout(this.chatTimer);
      this.chatTimer = null;
    }

    if (!this.liveChatId) {
      if (this.videoId) {
        await this.resolveLiveChatId();
      }
      if (!this.liveChatId) {
        this.isPollingChat = false;
        // Recheck in 15 seconds if chat ID could not be determined
        this.chatTimer = setTimeout(() => this.pollChat(), 15000);
        return;
      }
    }

    try {
      console.log('[YouTube] Chat request sent');
      const youtube = this.getYouTubeClient();
      const params = {
        liveChatId: this.liveChatId,
        part: ['snippet', 'authorDetails'],
        maxResults: 2000
      };
      if (this.nextPageToken) {
        params.pageToken = this.nextPageToken;
      }

      const res = await youtube.liveChatMessages.list(params);
      const items = res.data.items || [];
      console.log(`[YouTube] Messages received: ${items.length}`);

      // Store latest page token to prevent duplicates
      if (res.data.nextPageToken) {
        this.nextPageToken = res.data.nextPageToken;
      }

      let countUpdated = 0;
      if (items.length > 0) {
        for (const item of items) {
          const success = this.processChatMessage(item);
          if (success) countUpdated++;
        }
        if (countUpdated > 0) {
          this.emitter.emit('scores_update', db.getCountries());
          console.log(`[YouTube] Successfully updated counts for ${countUpdated}/${items.length} messages.`);
        }
      }

      // Interval logic:
      // Target approximately 10 seconds (10,000ms).
      // If YouTube specifies pollingIntervalMillis > 10s, respect YouTube's interval.
      // Never poll faster than 10 seconds.
      const TARGET_INTERVAL_MS = 10000;
      const ytRecommendedMs = res.data.pollingIntervalMillis || 0;
      const nextDelay = Math.max(TARGET_INTERVAL_MS, ytRecommendedMs);
      console.log(`[YouTube] Next poll in: ${Math.round(nextDelay / 1000)} seconds`);

      this.backoffMs = 0;
      if (this.isRunning && !this.quotaExhausted) {
        this.chatTimer = setTimeout(() => this.pollChat(), nextDelay);
      }
    } catch (err) {
      const errorObj = err.response?.data?.error || err;
      const errors = errorObj.errors || err.errors || [];
      const reason = errors[0]?.reason || '';
      const message = errorObj.message || err.message || '';
      const code = err.code || err.status || errorObj.code;

      // 1. Quota Exceeded
      if (reason === 'quotaExceeded' || message.toLowerCase().includes('quota')) {
        console.error(`[YouTube] Quota/rate limit error: quotaExceeded (${message})`);
        if (this.switchKeyOnQuotaExceeded()) {
          this.isPollingChat = false;
          this.chatTimer = setTimeout(() => this.pollChat(), 5000);
          return;
        }
        this.quotaExhausted = true;
        console.error('[YouTube] Quota exhausted. Stopping unnecessary API requests.');
        this.stop();
        this.emitter.emit('event', {
          type: 'system',
          user: 'SYSTEM',
          message: '⚠️ YouTube API Quota Exceeded. Polling stopped.'
        });
        return;
      }

      // 2. Rate Limit Exceeded
      if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
        console.error(`[YouTube] Quota/rate limit error: rateLimitExceeded (${message})`);
        console.log('[YouTube] Next poll in: 30 seconds');
        this.isPollingChat = false;
        this.chatTimer = setTimeout(() => this.pollChat(), 30000);
        return;
      }

      // 3. Live Chat Ended
      if (reason === 'liveChatEnded' || message.toLowerCase().includes('live chat has ended') || message.toLowerCase().includes('livechatended')) {
        console.log('[YouTube] Live chat ended');
        this.stop();
        return;
      }

      // 4. Invalid Page Token
      if (reason === 'invalidPageToken' || message.toLowerCase().includes('invalid page token') || message.toLowerCase().includes('invalidpagetoken')) {
        console.warn('[YouTube] Invalid page token encountered. Resetting page token...');
        this.nextPageToken = null;
        console.log('[YouTube] Next poll in: 10 seconds');
        this.isPollingChat = false;
        this.chatTimer = setTimeout(() => this.pollChat(), 10000);
        return;
      }

      // 5. Auth / API Key Error
      if (code === 401 || reason === 'authError' || reason === 'keyInvalid') {
        console.error(`[YouTube] API authentication error: ${message}`);
        if (this.switchKeyOnQuotaExceeded()) {
          this.isPollingChat = false;
          this.chatTimer = setTimeout(() => this.pollChat(), 5000);
          return;
        }
        this.stop();
        return;
      }

      // 6. Network errors
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        console.warn(`[YouTube] Network error (${err.code}). Retrying in 15 seconds...`);
        this.isPollingChat = false;
        this.chatTimer = setTimeout(() => this.pollChat(), 15000);
        return;
      }

      // 7. General fallback with backoff
      console.warn('[YouTube Chat] Error:', message);
      this.backoffMs = Math.min(30000, (this.backoffMs || 10000) * 1.5);
      console.log(`[YouTube] Next poll in: ${Math.round(this.backoffMs / 1000)} seconds`);
      if (this.isRunning && !this.quotaExhausted) {
        this.chatTimer = setTimeout(() => this.pollChat(), this.backoffMs);
      }
    } finally {
      this.isPollingChat = false;
    }
  }

  processChatMessage(item) {
    const messageId = item.id;
    if (db.isEventProcessed(messageId)) {
      return false; // Deduplicate
    }
    db.markEventProcessed(messageId, 'chat');

    const snippet = item.snippet || {};
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
      const multiplier = this.getMultiplier ? this.getMultiplier() : 1;
      const basePoints = Math.max(1, Math.round(usdAmount * pointsPerUsd));
      const points = basePoints * multiplier;

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
      console.log(`[YouTube Superchat] 💰 $${usdAmount.toFixed(2)} by ${displayName} -> ${country.name} (+${points} pts)`);

      // Broadcast Activity Event & Leaderboards
      this.emitter.emit('event', {
        type: 'superchat',
        user: displayName,
        country: country.name,
        code: country.code,
        points: points,
        usd: usdAmount,
        avatar: avatarUrl,
        isBonus: true,
        is2x: multiplier > 1,
        multiplier: multiplier
      });

      this.emitter.emit('superchat_update', topDonors);
      this.emitter.emit('scores_update', db.getCountries());
      return true;
    }

    // B. Standard Text Chat Message
    const text = (snippet.displayMessage || snippet.textMessageDetails?.messageText || '').trim();
    let country = detectCountry(text);

    // Fallback 1: Check if message is voting for rank number (#1, 1, +1, 2, #2, etc.)
    if (!country) {
      const numMatch = text.match(/^#?(\+)?([1-9]|10)$/);
      if (numMatch) {
        const rank = parseInt(numMatch[2], 10);
        const topCountries = db.getCountries();
        if (topCountries[rank - 1]) {
          country = topCountries[rank - 1];
        }
      }
    }

    // Fallback 2: Check if user previously voted for a country
    if (!country) {
      const user = db.getUser(channelId);
      if (user && user.last_country) {
        country = db.getCountry(user.last_country);
      }
    }

    if (!country) {
      console.log(`[YouTube Chat] ⚠️ "${text}" by ${displayName} (no country matched)`);
      return false; // Ignore messages not matching any country
    }

    const cooldownMs = this.config.game?.chatCooldownMs ?? 0;
    const maxPerMin = this.config.game?.maxChatsPerMin ?? 120;

    const chatResult = db.recordUserChat(channelId, displayName, avatarUrl, country.code, cooldownMs, maxPerMin);
    if (!chatResult.allowed) {
      console.log(`[YouTube Chat] ⏳ Rate-limited: "${text}" by ${displayName} (${chatResult.reason})`);
      return false;
    }

    const multiplier = this.getMultiplier ? this.getMultiplier() : 1;
    const basePoints = (chatResult.pointsEarned || this.config.points?.pointsPerChat || 1) * multiplier;
    let earnedPoints = basePoints;

    // Check if user had pending subscriber reward
    const pendingPoints = db.claimPendingSubscriber(channelId);
    if (pendingPoints > 0) {
      const boostedPending = pendingPoints * multiplier;
      earnedPoints += boostedPending;
      db.addPointsToUser(channelId, boostedPending);
    }

    db.addPoints(country.code, earnedPoints, displayName, true);
    this.lastChatterCountry = country;
    console.log(`[YouTube Chat] 💬 "${text}" by ${displayName} -> ${country.name} (+${earnedPoints} pts)`);

    // Emit event for scoreboard banner
    this.emitter.emit('event', {
      type: 'chat',
      user: displayName,
      level: chatResult.oldLevel || chatResult.level || 1,
      country: country.name,
      code: country.code,
      points: earnedPoints,
      avatar: avatarUrl,
      isBonus: earnedPoints > 1,
      is2x: multiplier > 1,
      multiplier: multiplier
    });

    this.emitter.emit('scores_update', db.getCountries());
    return true;
  }

  // 2. VIDEO LIKES POLLING (Operation 2)
  async pollLikes() {
    if (!this.isRunning || this.quotaExhausted) return;

    // Enforce SINGLE polling loop
    if (this.isPollingLikes) return;
    this.isPollingLikes = true;

    if (this.likeTimer) {
      clearTimeout(this.likeTimer);
      this.likeTimer = null;
    }

    try {
      if (this.videoId) {
        const youtube = this.getYouTubeClient();
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
      }
    } catch (err) {
      const errorObj = err.response?.data?.error || err;
      const errors = errorObj.errors || err.errors || [];
      const reason = errors[0]?.reason || '';
      const message = errorObj.message || err.message || '';

      if (reason === 'quotaExceeded' || message.toLowerCase().includes('quota')) {
        console.error(`[YouTube Likes] Quota error: ${message}`);
        if (!this.switchKeyOnQuotaExceeded()) {
          this.quotaExhausted = true;
          this.stop();
          return;
        }
      } else {
        console.warn('[YouTube Likes] Polling error:', message);
      }
    } finally {
      this.isPollingLikes = false;
    }

    if (this.isRunning && !this.quotaExhausted) {
      this.likeTimer = setTimeout(() => this.pollLikes(), 10000);
    }
  }

  handleLikeDelta(delta) {
    if (delta <= 0) return;
    const pointsPerLike = this.config.points?.pointsPerLike || 400;
    const multiplier = this.getMultiplier ? this.getMultiplier() : 1;
    const totalPoints = delta * pointsPerLike * multiplier;
    const likeMode = this.config.game?.likeMode || 'active_split';

    console.log(`[YouTube] Detected +${delta} new likes! Distributing ${totalPoints} points (x${multiplier}) using mode '${likeMode}'`);

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
          user: 'Stream Likes',
          is2x: multiplier > 1,
          multiplier: multiplier
        });
      }
    } else if (likeMode === 'last_chatter' && this.lastChatterCountry) {
      db.addPoints(this.lastChatterCountry.code, totalPoints);
      this.emitter.emit('event', {
        type: 'like',
        country: this.lastChatterCountry.name,
        code: this.lastChatterCountry.code,
        points: totalPoints,
        user: 'Stream Likes',
        is2x: multiplier > 1,
        multiplier: multiplier
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
              user: 'Stream Likes',
              is2x: multiplier > 1,
              multiplier: multiplier
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
            user: 'Stream Likes',
            is2x: multiplier > 1,
            multiplier: multiplier
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
          const multiplier = this.getMultiplier ? this.getMultiplier() : 1;
          const pointsPerSub = (this.config.points?.pointsPerSubscribe || 400) * multiplier;

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
                  level: user.level || 1,
                  is2x: multiplier > 1,
                  multiplier: multiplier
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
