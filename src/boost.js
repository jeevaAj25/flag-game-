// 2X Boost Manager for Live Flag Count Fight
// Automatically triggers a 2X Multiplier frenzy every 10 minutes (and allows manual triggers)

class BoostManager {
  constructor(config, eventEmitter, broadcastFn, onDoubleScores) {
    this.config = config;
    this.emitter = eventEmitter;
    this.broadcast = broadcastFn;
    this.onDoubleScores = onDoubleScores;

    const game = config.game || {};
    this.intervalMinutes = parseInt(game.boostIntervalMinutes || 10, 10);
    this.intervalSeconds = this.intervalMinutes * 60;
    this.durationSeconds = parseInt(game.boostDurationSeconds || 60, 10);
    this.multiplierValue = parseInt(game.boostMultiplier || 2, 10);
    this.autoEnabled = game.boostAutoEnabled !== false;

    this.active = false;
    this.remainingSeconds = 0;
    this.nextBoostSeconds = this.intervalSeconds;
    this.timer = null;

    this.startTimer();
  }

  startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (this.active) {
      this.remainingSeconds--;
      if (this.remainingSeconds <= 0) {
        this.endBoost();
      } else {
        this.broadcastStatus();
      }
    } else if (this.autoEnabled) {
      this.nextBoostSeconds--;
      if (this.nextBoostSeconds <= 0) {
        this.triggerBoost(this.durationSeconds);
      } else {
        // Broadcast periodic status
        this.broadcastStatus();
      }
    }
  }

  triggerBoost(duration = this.durationSeconds) {
    this.active = true;
    this.remainingSeconds = duration;
    this.nextBoostSeconds = this.intervalSeconds;

    console.log(`[Boost] 🔥 2X BOOST ACTIVATED for ${duration} seconds! All points x2!`);

    this.emitter.emit('event', {
      type: 'boost_start',
      user: 'SYSTEM',
      country: 'ALL COUNTRIES',
      points: '2X MULTIPLIER',
      isBonus: true,
      message: `⚡ 2X BOOST IS ACTIVE! ALL POINTS MULTIPLIED BY 2 FOR ${duration}s! ⚡`
    });

    this.broadcastStatus();
  }

  endBoost() {
    this.active = false;
    this.remainingSeconds = 0;
    this.nextBoostSeconds = this.intervalSeconds;

    console.log(`[Boost] 2X Boost ended. Next boost in ${this.intervalMinutes} minutes.`);

    this.emitter.emit('event', {
      type: 'boost_end',
      user: 'SYSTEM',
      country: 'ALL COUNTRIES',
      points: '1X (NORMAL)',
      isBonus: false,
      message: '⚡ 2X Boost has ended! Back to standard points.'
    });

    this.broadcastStatus();
  }

  getMultiplier() {
    return this.active ? this.multiplierValue : 1;
  }

  getStatus() {
    return {
      active: this.active,
      multiplier: this.getMultiplier(),
      remainingSeconds: this.remainingSeconds,
      nextBoostSeconds: this.nextBoostSeconds,
      intervalSeconds: this.intervalSeconds,
      intervalMinutes: this.intervalMinutes,
      durationSeconds: this.durationSeconds,
      autoEnabled: this.autoEnabled
    };
  }

  broadcastStatus() {
    if (this.broadcast) {
      this.broadcast({
        type: 'BOOST_STATUS',
        data: this.getStatus()
      });
    }
  }

  updateConfig(cfg) {
    if (!cfg) return;
    if (cfg.intervalMinutes !== undefined) {
      this.intervalMinutes = Math.max(1, parseInt(cfg.intervalMinutes, 10) || 10);
      this.intervalSeconds = this.intervalMinutes * 60;
      if (!this.active && this.nextBoostSeconds > this.intervalSeconds) {
        this.nextBoostSeconds = this.intervalSeconds;
      }
    }
    if (cfg.durationSeconds !== undefined) {
      this.durationSeconds = Math.max(5, parseInt(cfg.durationSeconds, 10) || 60);
    }
    if (cfg.autoEnabled !== undefined) {
      this.autoEnabled = Boolean(cfg.autoEnabled);
    }
    if (cfg.multiplier !== undefined) {
      this.multiplierValue = Math.max(2, parseInt(cfg.multiplier, 10) || 2);
    }

    if (this.config && this.config.game) {
      this.config.game.boostIntervalMinutes = this.intervalMinutes;
      this.config.game.boostDurationSeconds = this.durationSeconds;
      this.config.game.boostAutoEnabled = this.autoEnabled;
      this.config.game.boostMultiplier = this.multiplierValue;
    }

    this.broadcastStatus();
  }
}

module.exports = BoostManager;
