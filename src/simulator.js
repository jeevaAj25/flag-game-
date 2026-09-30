// Simulator Engine for Live Flag Count Fight
// Simulates live YouTube chat traffic, Super Chats, Likes, and Subscriptions

const { detectCountry } = require('./countries');
const db = require('./db');

class Simulator {
  constructor(config, eventEmitter) {
    this.config = config;
    this.emitter = eventEmitter;
    this.isRunning = false;
    this.timer = null;

    this.sampleUsers = [
      { name: '@BimaSena-g7x', avatar: '/assets/avatar1.svg', defaultCountry: 'id', initialLevel: 3 },
      { name: '@anthony...', avatar: '/assets/avatar1.svg', defaultCountry: 'sa', initialLevel: 2 },
      { name: '@crocodil...', avatar: '/assets/avatar2.svg', defaultCountry: 'in', initialLevel: 1 },
      { name: '@FundAlonzo', avatar: '/assets/avatar2.svg', defaultCountry: 'ph', initialLevel: 4 },
      { name: '@MdDeloyar-y2n', avatar: '/assets/avatar1.svg', defaultCountry: 'bd', initialLevel: 1 },
      { name: '@RianAjok-q9q', avatar: '/assets/avatar2.svg', defaultCountry: 'id', initialLevel: 2 },
      { name: '@aqilazayda-b5n', avatar: '/assets/avatar1.svg', defaultCountry: 'id', initialLevel: 3 },
      { name: '@malt5', avatar: '/assets/avatar2.svg', defaultCountry: 'gr', initialLevel: 2 },
      { name: '@fans-slendytubbies', avatar: '/assets/avatar1.svg', defaultCountry: 'my', initialLevel: 1 },
      { name: '@bautistafamily2079', avatar: '/assets/avatar2.svg', defaultCountry: 'ph', initialLevel: 2 },
      { name: '@lucas_br', avatar: '/assets/avatar1.svg', defaultCountry: 'br', initialLevel: 1 },
      { name: '@john_usa', avatar: '/assets/avatar2.svg', defaultCountry: 'us', initialLevel: 5 }
    ];
  }

  simulateChat(customUser = null, countryText = null, forcedLevel = null) {
    const userObj = customUser || this.sampleUsers[Math.floor(Math.random() * this.sampleUsers.length)];
    const text = countryText || userObj.defaultCountry;
    const country = detectCountry(text) || { code: 'id', name: 'Indonesia' };

    const channelId = 'sim_' + userObj.name.replace(/[^a-zA-Z0-9]/g, '');

    // Seed initial level if user does not exist yet
    if (!db.getUser(channelId) && userObj.initialLevel) {
      db.setUserLevel(channelId, userObj.initialLevel);
    }
    if (forcedLevel !== null && forcedLevel !== undefined) {
      db.setUserLevel(channelId, parseInt(forcedLevel, 10));
    }

    const chatResult = db.recordUserChat(channelId, userObj.name, userObj.avatar, country.code, 500, 100);

    const pointsToAdd = chatResult.pointsEarned;

    db.addPoints(country.code, pointsToAdd, userObj.name, true);

    this.emitter.emit('event', {
      type: 'chat',
      user: userObj.name,
      level: chatResult.oldLevel || chatResult.level || 1,
      country: country.name,
      code: country.code,
      points: pointsToAdd,
      avatar: userObj.avatar,
      isBonus: pointsToAdd > 1
    });

    this.emitter.emit('scores_update', db.getCountries());
  }

  simulateSuperchat(usd = 2.67, customUser = null, countryCode = null) {
    const userObj = customUser || this.sampleUsers[Math.floor(Math.random() * this.sampleUsers.length)];
    const country = countryCode ? db.getCountry(countryCode) : db.getCountry(userObj.defaultCountry);
    const cName = country ? country.name : 'Saudi Arabia';
    const cCode = country ? country.code : 'sa';

    const pointsPerUsd = this.config.points?.pointsPerUsd || 4000;
    const points = Math.round(usd * pointsPerUsd);
    const channelId = 'sim_donor_' + userObj.name.replace(/[^a-zA-Z0-9]/g, '');

    db.addPoints(cCode, points, userObj.name, true);

    const topDonors = db.recordSuperchat(
      channelId,
      userObj.name,
      userObj.avatar,
      cCode,
      cName,
      usd,
      points
    );

    this.emitter.emit('event', {
      type: 'superchat',
      user: userObj.name,
      country: cName,
      code: cCode,
      points: points,
      usd: usd,
      avatar: userObj.avatar,
      isBonus: true
    });

    this.emitter.emit('superchat_update', topDonors);
    this.emitter.emit('scores_update', db.getCountries());
  }

  simulateLike(count = 1) {
    const pointsPerLike = this.config.points?.pointsPerLike || 400;
    const totalPoints = count * pointsPerLike;

    const likeMode = this.config.game?.likeMode || 'active_split';
    let targetCountry = null;

    if (likeMode === 'top_country') {
      targetCountry = db.getCountries()[0];
    } else {
      const active = db.getRecentCountryActivity(60);
      if (active.length > 0) {
        targetCountry = db.getCountry(active[0].country_code);
      } else {
        targetCountry = db.getCountries()[0];
      }
    }

    if (!targetCountry) targetCountry = { code: 'id', name: 'Indonesia' };

    db.addPoints(targetCountry.code, totalPoints);

    this.emitter.emit('event', {
      type: 'like',
      user: 'Stream Likes',
      country: targetCountry.name,
      code: targetCountry.code,
      points: totalPoints,
      isBonus: true
    });

    this.emitter.emit('scores_update', db.getCountries());
  }

  simulateSubscribe(customUser = null) {
    const userObj = customUser || this.sampleUsers[Math.floor(Math.random() * this.sampleUsers.length)];
    const country = db.getCountry(userObj.defaultCountry) || { code: 'id', name: 'Indonesia' };
    const points = this.config.points?.pointsPerSubscribe || 400;

    db.addPoints(country.code, points, userObj.name, true);

    this.emitter.emit('event', {
      type: 'subscribe',
      user: userObj.name,
      country: country.name,
      code: country.code,
      points: points,
      level: 2,
      isBonus: true
    });

    this.emitter.emit('scores_update', db.getCountries());
  }

  startTraffic(intervalMs = 1200) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Simulator] Starting simulated chat traffic...');

    const step = () => {
      if (!this.isRunning) return;

      const roll = Math.random();
      if (roll < 0.85) {
        // Regular chat message
        this.simulateChat();
      } else if (roll < 0.95) {
        // Like burst
        this.simulateLike(1);
      } else if (roll < 0.98) {
        // Subscribe
        this.simulateSubscribe();
      } else {
        // Super Chat!
        const amounts = [0.42, 1.00, 2.67, 5.00, 10.00];
        const randomAmount = amounts[Math.floor(Math.random() * amounts.length)];
        this.simulateSuperchat(randomAmount);
      }

      // Vary interval between 600ms and 1800ms for realistic live chat rhythm
      const jitter = Math.floor(Math.random() * 800) - 400;
      const nextDelay = Math.max(500, intervalMs + jitter);
      this.timer = setTimeout(step, nextDelay);
    };

    this.timer = setTimeout(step, 500);
  }

  stopTraffic() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    console.log('[Simulator] Stopped simulated chat traffic.');
  }
}

module.exports = Simulator;
