// SQLite Database Service for Live Flag Count Fight
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { COUNTRIES } = require('./countries');

const DB_PATH = path.join(__dirname, '..', 'data', 'game.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function initDb() {
  // 1. Countries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS countries (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      top_contributor TEXT DEFAULT '',
      top_contributor_points INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // 2. Users table (tracks chatters, level, anti-spam)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      channel_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      last_country TEXT DEFAULT '',
      total_points INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      last_chat_at INTEGER DEFAULT 0,
      chat_window_start INTEGER DEFAULT 0,
      chat_window_count INTEGER DEFAULT 0
    );
  `);

  // 3. Superchat Donors table
  db.exec(`
    CREATE TABLE IF NOT EXISTS superchat_donors (
      channel_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      country_code TEXT DEFAULT '',
      country_name TEXT DEFAULT '',
      total_usd REAL DEFAULT 0.0,
      total_points INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // 4. Processed Events table (idempotency deduplication)
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // 5. Game Settings (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 6. Pending Subscribers pool
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_subscribers (
      channel_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      points INTEGER DEFAULT 400,
      timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // 7. Recent chat activity window for active_split like distribution
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_time ON chat_activity_log(timestamp);
  `);

  seedInitialData();
}

const DEFAULT_LEVEL_POINTS = {
  1: 1,
  2: 5,
  3: 10,
  4: 15,
  5: 20,
  6: 30,
  7: 50,
  8: 75,
  9: 100,
  10: 150
};

const DEFAULT_LEVEL_THRESHOLDS = [
  { level: 10, points: 20000 },
  { level: 9,  points: 10000 },
  { level: 8,  points: 5000 },
  { level: 7,  points: 3000 },
  { level: 6,  points: 1500 },
  { level: 5,  points: 500 },
  { level: 4,  points: 200 },
  { level: 3,  points: 50 },
  { level: 2,  points: 10 },
  { level: 1,  points: 0 }
];

let globalConfig = null;
function setConfig(cfg) {
  globalConfig = cfg;
}

function getPointsForLevel(level) {
  const lvl = Math.max(1, parseInt(level, 10) || 1);
  const customMap = globalConfig?.points?.pointsPerLevel || globalConfig?.levels?.pointsPerLevel;
  if (customMap && customMap[lvl] !== undefined) {
    return Number(customMap[lvl]);
  }
  if (DEFAULT_LEVEL_POINTS[lvl] !== undefined) {
    return DEFAULT_LEVEL_POINTS[lvl];
  }
  return 150 + (lvl - 10) * 50;
}

function calculateLevel(points) {
  const pts = Math.max(0, parseInt(points, 10) || 0);
  const thresholds = globalConfig?.levels?.thresholds || DEFAULT_LEVEL_THRESHOLDS;
  for (const t of thresholds) {
    if (pts >= t.points) {
      return t.level;
    }
  }
  return 1;
}


function seedInitialData() {
  const count = db.prepare('SELECT COUNT(*) as count FROM countries').get().count;
  if (count === 0) {
    console.log('[DB] Initializing countries with 0 score (clean state for live stream)...');
    const insertCountry = db.prepare(`
      INSERT INTO countries (code, name, score, top_contributor, top_contributor_points)
      VALUES (@code, @name, 0, '', 0)
    `);

    const insertMany = db.transaction((countries) => {
      for (const c of countries) {
        insertCountry.run({
          code: c.code.toLowerCase(),
          name: c.name
        });
      }
    });

    insertMany(COUNTRIES);
  }
}

// Queries & Mutations
function getCountries() {
  return db.prepare('SELECT code, name, score, top_contributor, top_contributor_points FROM countries ORDER BY score DESC').all();
}

function getCountry(code) {
  return db.prepare('SELECT * FROM countries WHERE code = ?').get(code.toLowerCase());
}

function addPoints(code, points, chatterName = '', isChatter = false) {
  const countryCode = code.toLowerCase();
  const current = getCountry(countryCode);
  if (!current) return null;

  const newScore = Math.max(0, current.score + points);
  let newTop = current.top_contributor;
  let newTopPts = current.top_contributor_points;

  if (chatterName && isChatter) {
    newTop = chatterName;
    newTopPts = (newTopPts || 0) + points;
  }

  db.prepare(`
    UPDATE countries 
    SET score = ?, top_contributor = ?, top_contributor_points = ?, updated_at = strftime('%s', 'now')
    WHERE code = ?
  `).run(newScore, newTop, newTopPts, countryCode);

  // Log to chat_activity_log for active_split like distribution
  db.prepare('INSERT INTO chat_activity_log (country_code, timestamp) VALUES (?, ?)').run(countryCode, Math.floor(Date.now() / 1000));

  return { code: countryCode, score: newScore, name: current.name };
}

function recordUserChat(channelId, displayName, avatarUrl, countryCode, cooldownMs = 3000, maxPerMin = 20, customPoints = null) {
  const now = Date.now();
  let user = db.prepare('SELECT * FROM users WHERE channel_id = ?').get(channelId);

  if (!user) {
    user = {
      channel_id: channelId,
      display_name: displayName,
      avatar_url: avatarUrl || '',
      last_country: countryCode,
      total_points: 0,
      level: 1,
      last_chat_at: 0,
      chat_window_start: now,
      chat_window_count: 0
    };
    db.prepare(`
      INSERT INTO users (channel_id, display_name, avatar_url, last_country, total_points, level, last_chat_at, chat_window_start, chat_window_count)
      VALUES (@channel_id, @display_name, @avatar_url, @last_country, @total_points, @level, @last_chat_at, @chat_window_start, @chat_window_count)
    `).run(user);
  }

  // Anti-spam check (if cooldownMs configured > 0)
  if (cooldownMs > 0 && now - user.last_chat_at < cooldownMs) {
    return { allowed: false, reason: 'cooldown', user, pointsEarned: 0 };
  }

  let windowStart = user.chat_window_start;
  let windowCount = user.chat_window_count;
  if (now - windowStart > 60000) {
    windowStart = now;
    windowCount = 0;
  }

  if (windowCount >= maxPerMin) {
    return { allowed: false, reason: 'rate_limit', user, pointsEarned: 0 };
  }

  windowCount++;
  const oldLevel = user.level || calculateLevel(user.total_points || 0);
  // Calculate points according to user's level! Level 1 = 1, Level 2 = 5, Level 3 = 10...
  const earnedPoints = customPoints !== null ? customPoints : getPointsForLevel(oldLevel);
  const newTotal = (user.total_points || 0) + earnedPoints;
  const newLevel = calculateLevel(newTotal);

  db.prepare(`
    UPDATE users 
    SET display_name = ?, avatar_url = ?, last_country = ?, total_points = ?, level = ?, last_chat_at = ?, chat_window_start = ?, chat_window_count = ?
    WHERE channel_id = ?
  `).run(displayName, avatarUrl || user.avatar_url, countryCode, newTotal, newLevel, now, windowStart, windowCount, channelId);

  return {
    allowed: true,
    pointsEarned: earnedPoints,
    level: newLevel,
    oldLevel,
    levelUp: newLevel > oldLevel,
    totalPoints: newTotal,
    user: { ...user, display_name: displayName, last_country: countryCode, level: newLevel, total_points: newTotal }
  };
}

function setUserLevel(channelId, level) {
  const lvl = Math.max(1, parseInt(level, 10) || 1);
  const thresholds = globalConfig?.levels?.thresholds || DEFAULT_LEVEL_THRESHOLDS;
  const targetThreshold = thresholds.find(t => t.level === lvl) || { points: 0 };
  const targetPoints = targetThreshold.points;

  const user = db.prepare('SELECT * FROM users WHERE channel_id = ?').get(channelId);
  if (user) {
    db.prepare('UPDATE users SET level = ?, total_points = ? WHERE channel_id = ?').run(lvl, targetPoints, channelId);
  } else {
    db.prepare(`
      INSERT INTO users (channel_id, display_name, avatar_url, last_country, total_points, level, last_chat_at, chat_window_start, chat_window_count)
      VALUES (?, ?, '', '', ?, ?, 0, 0, 0)
    `).run(channelId, channelId, targetPoints, lvl);
  }
}

function addPointsToUser(channelId, points) {
  const user = db.prepare('SELECT * FROM users WHERE channel_id = ?').get(channelId);
  if (user) {
    const newTotal = (user.total_points || 0) + points;
    const newLevel = calculateLevel(newTotal);
    db.prepare('UPDATE users SET total_points = ?, level = ? WHERE channel_id = ?').run(newTotal, newLevel, channelId);
  }
}

function getUser(channelId) {
  return db.prepare('SELECT * FROM users WHERE channel_id = ?').get(channelId);
}

function recordSuperchat(channelId, displayName, avatarUrl, countryCode, countryName, usdAmount, points) {
  const now = Math.floor(Date.now() / 1000);
  const donor = db.prepare('SELECT * FROM superchat_donors WHERE channel_id = ?').get(channelId);

  if (donor) {
    const updatedUsd = Math.round((donor.total_usd + usdAmount) * 100) / 100;
    const updatedPts = donor.total_points + points;
    db.prepare(`
      UPDATE superchat_donors
      SET display_name = ?, avatar_url = ?, country_code = ?, country_name = ?, total_usd = ?, total_points = ?, updated_at = ?
      WHERE channel_id = ?
    `).run(displayName, avatarUrl || donor.avatar_url, countryCode || donor.country_code, countryName || donor.country_name, updatedUsd, updatedPts, now, channelId);
  } else {
    db.prepare(`
      INSERT INTO superchat_donors (channel_id, display_name, avatar_url, country_code, country_name, total_usd, total_points, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(channelId, displayName, avatarUrl, countryCode, countryName, usdAmount, points, now);
  }

  // Update user points and level as well
  let user = db.prepare('SELECT * FROM users WHERE channel_id = ?').get(channelId);
  if (user) {
    const newTotal = user.total_points + points;
    const newLevel = calculateLevel(newTotal);
    db.prepare(`UPDATE users SET total_points = ?, level = ?, last_country = ? WHERE channel_id = ?`)
      .run(newTotal, newLevel, countryCode || user.last_country, channelId);
  }

  // Increment current raised goal in game_settings
  const currentGoalStr = getSetting('currentGoalAmount', '3.08');
  const currentGoal = parseFloat(currentGoalStr) || 0;
  const newGoalRaised = Math.round((currentGoal + usdAmount) * 100) / 100;
  setSetting('currentGoalAmount', newGoalRaised.toString());

  return getTopDonors(2);
}

function getTopDonors(limit = 2) {
  return db.prepare('SELECT * FROM superchat_donors ORDER BY total_usd DESC, total_points DESC LIMIT ?').all(limit);
}

function isEventProcessed(eventId) {
  if (!eventId) return false;
  const row = db.prepare('SELECT 1 FROM processed_events WHERE event_id = ?').get(eventId);
  return Boolean(row);
}

function markEventProcessed(eventId, eventType) {
  if (!eventId) return;
  try {
    db.prepare('INSERT OR IGNORE INTO processed_events (event_id, event_type) VALUES (?, ?)').run(eventId, eventType);
  } catch (e) {
    // Ignore duplicate
  }
}

function getRecentCountryActivity(seconds = 60) {
  const cutoff = Math.floor(Date.now() / 1000) - seconds;
  // Clean old logs
  db.prepare('DELETE FROM chat_activity_log WHERE timestamp < ?').run(cutoff - 120);

  const rows = db.prepare(`
    SELECT country_code, COUNT(*) as count 
    FROM chat_activity_log 
    WHERE timestamp >= ? 
    GROUP BY country_code 
    ORDER BY count DESC
  `).all(cutoff);

  return rows;
}

function resetScores(seed = true) {
  db.prepare('DELETE FROM chat_activity_log').run();
  db.prepare('DELETE FROM superchat_donors').run();
  db.prepare('UPDATE countries SET score = 0, top_contributor = \'\', top_contributor_points = 0').run();
  db.prepare('UPDATE game_settings SET value = \'0.00\' WHERE key = \'currentGoalAmount\'').run();
  if (seed) {
    seedInitialData();
  }
}

function doubleAllScores() {
  db.prepare('UPDATE countries SET score = score * 2 WHERE score > 0').run();
  return getCountries();
}

function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM game_settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO game_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, String(value), String(value));
}

// Pending subscribers pool
function addPendingSubscriber(channelId, displayName, points = 400) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR REPLACE INTO pending_subscribers (channel_id, display_name, points, timestamp) VALUES (?, ?, ?, ?)')
    .run(channelId, displayName, points, now);
}

function claimPendingSubscriber(channelId) {
  const row = db.prepare('SELECT * FROM pending_subscribers WHERE channel_id = ?').get(channelId);
  if (row) {
    db.prepare('DELETE FROM pending_subscribers WHERE channel_id = ?').run(channelId);
    return row.points;
  }
  return 0;
}

function cleanupPendingSubscribers(expireSeconds = 600) {
  const cutoff = Math.floor(Date.now() / 1000) - expireSeconds;
  const expired = db.prepare('SELECT * FROM pending_subscribers WHERE timestamp < ?').all(cutoff);
  if (expired.length > 0) {
    db.prepare('DELETE FROM pending_subscribers WHERE timestamp < ?').run(cutoff);
  }
  return expired;
}

initDb();

module.exports = {
  db,
  setConfig,
  getPointsForLevel,
  calculateLevel,
  setUserLevel,
  addPointsToUser,
  getCountries,
  getCountry,
  addPoints,
  recordUserChat,
  getUser,
  recordSuperchat,
  getTopDonors,
  isEventProcessed,
  markEventProcessed,
  getRecentCountryActivity,
  resetScores,
  doubleAllScores,
  getSetting,
  setSetting,
  addPendingSubscriber,
  claimPendingSubscriber,
  cleanupPendingSubscribers
};
