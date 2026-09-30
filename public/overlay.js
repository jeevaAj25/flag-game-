// Live Flag Count Fight - Overlay Client Controller
// Handles WebSocket updates, FLIP animations, score formatting, event queue, and particles

let countriesData = [];
let topDonorsData = [];
let goalData = { current: 3.08, target: 50.00 };
let socket = null;

// Event Queue for Activity Banner (min 800ms per event)
const eventQueue = [];
let isDisplayingEvent = false;

// Audio Synthesizer via Web Audio API
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }
}

function playPopSound() {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch (e) {}
}

function playSuperchatFanfare() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.09);
      gain.gain.setValueAtTime(0.18, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.09 + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.25);
    });
  } catch (e) {}
}

// Background Music (BGM) Controller (70% Volume, Alan Walker - The Spectre)
let bgmAudio = null;
let bgmVolume = 0.7; // 70% sound
let bgmEnabled = true;

function initBgm(audioSettings) {
  if (!bgmAudio) {
    bgmAudio = document.getElementById('bgm-audio');
  }
  if (audioSettings) {
    if (audioSettings.bgmVolume !== undefined) bgmVolume = parseFloat(audioSettings.bgmVolume);
    if (audioSettings.bgmEnabled !== undefined) bgmEnabled = Boolean(audioSettings.bgmEnabled);
    if (audioSettings.bgmTrackName) {
      const titleEl = document.getElementById('bgm-title-text');
      if (titleEl) titleEl.textContent = audioSettings.bgmTrackName;
    }
  }
  if (bgmAudio) {
    bgmAudio.volume = bgmVolume;
    const volEl = document.getElementById('bgm-vol-text');
    if (volEl && bgmEnabled) volEl.textContent = Math.round(bgmVolume * 100) + '%';
    if (bgmEnabled) {
      playBgm();
    } else {
      pauseBgm();
    }
  }
}

function playBgm() {
  if (!bgmAudio) bgmAudio = document.getElementById('bgm-audio');
  if (!bgmAudio || !bgmEnabled) return;
  bgmAudio.volume = bgmVolume;
  bgmAudio.play().then(() => {
    updateBgmWidget(true);
  }).catch((err) => {
    console.log('[BGM] Waiting for user interaction to autoplay:', err);
    updateBgmWidget(false);
  });
}

function pauseBgm() {
  if (bgmAudio) {
    bgmAudio.pause();
  }
  updateBgmWidget(false);
}

function toggleBgm() {
  if (!bgmAudio) bgmAudio = document.getElementById('bgm-audio');
  if (!bgmAudio) return;
  if (bgmAudio.paused) {
    bgmEnabled = true;
    playBgm();
  } else {
    bgmEnabled = false;
    pauseBgm();
  }
}

function updateBgmWidget(isPlaying) {
  const widget = document.getElementById('bgm-widget');
  const volEl = document.getElementById('bgm-vol-text');
  if (!widget) return;
  if (isPlaying) {
    widget.classList.remove('paused');
    if (volEl) volEl.textContent = Math.round(bgmVolume * 100) + '%';
  } else {
    widget.classList.add('paused');
    if (volEl) volEl.textContent = 'PAUSED';
  }
}

// Format numbers according to spec:
// Below 10,000 -> 1,957, 7,236
// 10,000 and above -> 10k, 14.3k, 51.7k
function formatScore(score) {
  const num = Math.max(0, parseInt(score, 10) || 0);
  if (num < 10000) {
    return num.toLocaleString('en-US');
  }
  const inK = num / 1000;
  if (inK % 1 === 0) {
    return inK.toFixed(0) + 'k';
  }
  return inK.toFixed(1) + 'k';
}

function formatPointsBadge(pts) {
  if (pts >= 10000) {
    return '+' + (pts / 1000).toFixed(0) + 'K';
  } else if (pts >= 1000) {
    const inK = pts / 1000;
    return '+' + (inK % 1 === 0 ? inK.toFixed(0) : inK.toFixed(2)) + 'K';
  }
  return '+' + pts;
}

// Auto-scale canvas if viewing inside smaller window
function adjustScale() {
  const canvas = document.getElementById('canvas');
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (w === 1080 && h === 1920) {
    canvas.style.transform = 'none';
    return;
  }

  const scale = Math.min(w / 1080, h / 1920);
  canvas.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', adjustScale);
window.addEventListener('DOMContentLoaded', () => {
  bgmAudio = document.getElementById('bgm-audio');
  adjustScale();
  connectWebSocket();

  const widget = document.getElementById('bgm-widget');
  if (widget) {
    widget.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      toggleBgm();
    });
  }

  // Any user gesture starts audio and BGM if not already playing
  const gestureUnlock = () => {
    initAudio();
    if (bgmAudio && bgmAudio.paused && bgmEnabled) {
      playBgm();
    }
  };
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, gestureUnlock, { once: false });
  });

  // Try immediate playback (OBS CEF / Chrome with autoplay flags)
  playBgm();
});

// WebSocket Connection
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log('[Overlay] Connected to live game server');
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error('[Overlay] Parse error:', e);
    }
  };

  socket.onclose = () => {
    console.log('[Overlay] Disconnected. Reconnecting in 2s...');
    setTimeout(connectWebSocket, 2000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'INIT':
      countriesData = msg.data.countries || [];
      topDonorsData = msg.data.topDonors || [];
      goalData = msg.data.goal || goalData;
      updateSettings(msg.data.settings);
      if (msg.data.audio) {
        initBgm(msg.data.audio);
      }
      renderAll();
      if (msg.data.round && msg.data.round.winner) {
        showWinner(msg.data.round.winner);
      }
      break;

    case 'AUDIO_UPDATE':
      initBgm(msg.data);
      break;

    case 'SCORES_UPDATE':
      updateScores(msg.data);
      break;

    case 'ACTIVITY_EVENT':
      queueEvent(msg.data);
      break;

    case 'SUPERCHAT_UPDATE':
      topDonorsData = msg.data;
      renderDonors();
      break;

    case 'GOAL_UPDATE':
      goalData = msg.data;
      renderGoal();
      break;

    case 'SETTINGS_UPDATE':
      updateSettings(msg.data);
      break;

    case 'ROUND_STATUS':
      handleRoundStatus(msg.data);
      break;
  }
}

function updateSettings(settings) {
  if (!settings) return;
  const wmArea = document.getElementById('watermark-area');
  const wmText = document.getElementById('watermark-text');
  if (wmArea && wmText) {
    if (settings.watermarkEnabled !== undefined) {
      wmArea.style.display = settings.watermarkEnabled ? 'block' : 'none';
    }
    if (settings.watermarkText) {
      wmText.textContent = settings.watermarkText;
    }
  }
}

function renderAll() {
  renderPodium();
  renderGrid(false);
  renderDonors();
  renderGoal();
}

// Render Top 3 on Podium
function renderPodium() {
  if (!countriesData || countriesData.length < 3) return;

  const first = countriesData[0];
  const second = countriesData[1];
  const third = countriesData[2];

  // Rank 1 (Center)
  document.getElementById('podium-1-flag').src = `/flags/${first.code.toLowerCase()}.png`;
  document.getElementById('podium-1-score').textContent = formatScore(first.score);
  document.getElementById('podium-1-chatter').textContent = first.top_contributor || '';

  // Rank 2 (Left)
  document.getElementById('podium-2-flag').src = `/flags/${second.code.toLowerCase()}.png`;
  document.getElementById('podium-2-score').textContent = formatScore(second.score);

  // Rank 3 (Right)
  document.getElementById('podium-3-flag').src = `/flags/${third.code.toLowerCase()}.png`;
  document.getElementById('podium-3-score').textContent = formatScore(third.score);
}

// Render Flag Grid (Ranks 4-43, 8 columns x 5 rows = 40 tiles)
function renderGrid(animate = true) {
  const grid = document.getElementById('flag-grid');
  if (!grid || countriesData.length < 4) return;

  const gridCountries = countriesData.slice(3, 59);

  // Record old positions for FLIP animation
  const oldRects = new Map();
  if (animate) {
    Array.from(grid.children).forEach(child => {
      const code = child.getAttribute('data-code');
      if (code) {
        oldRects.set(code, child.getBoundingClientRect());
      }
    });
  }

  // Clear and re-populate
  grid.innerHTML = '';
  gridCountries.forEach((c) => {
    const tile = document.createElement('div');
    tile.className = 'flag-tile';
    tile.setAttribute('data-code', c.code.toLowerCase());

    const flagWrap = document.createElement('div');
    flagWrap.className = 'tile-flag-wrap';

    const img = document.createElement('img');
    img.src = `/flags/${c.code.toLowerCase()}.png`;
    img.alt = c.name;
    img.onerror = () => { img.src = `https://flagcdn.com/w160/${c.code.toLowerCase()}.png`; };

    flagWrap.appendChild(img);

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'tile-score';
    scoreDiv.textContent = formatScore(c.score);

    tile.appendChild(flagWrap);
    tile.appendChild(scoreDiv);

    // Re-attach active chatter tag if present for this country
    if (typeof activeTileTags !== 'undefined' && activeTileTags.has(c.code.toLowerCase())) {
      const activeInfo = activeTileTags.get(c.code.toLowerCase());
      if (activeInfo && activeInfo.tagEl) {
        tile.appendChild(activeInfo.tagEl);
        flagWrap.classList.add('tag-highlight');
        activeInfo.flagWrap = flagWrap;
        activeInfo.tile = tile;
      }
    }

    grid.appendChild(tile);

    // FLIP Animation
    if (animate && oldRects.has(c.code.toLowerCase())) {
      const oldRect = oldRects.get(c.code.toLowerCase());
      const newRect = tile.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;

      if (dx !== 0 || dy !== 0) {
        tile.style.transform = `translate(${dx}px, ${dy}px)`;
        tile.style.transition = 'none';

        requestAnimationFrame(() => {
          tile.style.transition = 'transform 0.45s cubic-bezier(0.25, 1, 0.5, 1)';
          tile.style.transform = 'none';
        });
      }
    }
  });
}

function updateScores(newCountries) {
  const prevTopCode = countriesData[0]?.code;
  countriesData = newCountries;

  renderPodium();
  renderGrid(true);

  // If #1 country changed, trigger celebratory sparkle!
  if (prevTopCode && countriesData[0]?.code !== prevTopCode) {
    spawnPodiumSparkles();
  }
}

// Render Donors
function renderDonors() {
  // Donor 1
  const d1 = topDonorsData && topDonorsData[0];
  const d1Flag = document.getElementById('donor-1-flag');
  if (d1 && d1.total_usd > 0) {
    document.getElementById('donor-1-name').textContent = d1.display_name;
    document.getElementById('donor-1-country').textContent = d1.country_name || '';
    document.getElementById('donor-1-usd').textContent = `$${parseFloat(d1.total_usd).toFixed(2)}`;
    document.getElementById('donor-1-points').textContent = formatPointsBadge(d1.total_points);
    if (d1.avatar_url) document.getElementById('donor-1-avatar').src = d1.avatar_url;
    if (d1.country_code) {
      d1Flag.src = `/flags/${d1.country_code.toLowerCase()}.png`;
      d1Flag.style.display = 'block';
    }
  } else {
    document.getElementById('donor-1-name').textContent = 'Top Donor #1';
    document.getElementById('donor-1-country').textContent = 'Awaiting Superchat';
    document.getElementById('donor-1-usd').textContent = '10$';
    document.getElementById('donor-1-points').textContent = '= 40000 points';
    document.getElementById('donor-1-avatar').src = '/assets/avatar1.svg';
    if (d1Flag) d1Flag.style.display = 'none';
  }

  // Donor 2
  const d2 = topDonorsData && topDonorsData[1];
  const d2Flag = document.getElementById('donor-2-flag');
  if (d2 && d2.total_usd > 0) {
    document.getElementById('donor-2-name').textContent = d2.display_name;
    document.getElementById('donor-2-country').textContent = d2.country_name || '';
    document.getElementById('donor-2-usd').textContent = `$${parseFloat(d2.total_usd).toFixed(2)}`;
    document.getElementById('donor-2-points').textContent = formatPointsBadge(d2.total_points);
    if (d2.avatar_url) document.getElementById('donor-2-avatar').src = d2.avatar_url;
    if (d2.country_code) {
      d2Flag.src = `/flags/${d2.country_code.toLowerCase()}.png`;
      d2Flag.style.display = 'block';
    }
  } else {
    document.getElementById('donor-2-name').textContent = 'Top Donor #2';
    document.getElementById('donor-2-country').textContent = 'Awaiting Superchat';
    document.getElementById('donor-2-usd').textContent = '10$';
    document.getElementById('donor-2-points').textContent = '= 40000 points';
    document.getElementById('donor-2-avatar').src = '/assets/avatar2.svg';
    if (d2Flag) d2Flag.style.display = 'none';
  }
}

// Render Goal
function renderGoal() {
  const cur = parseFloat(goalData.current) || 0;
  const target = parseFloat(goalData.target) || 50;
  document.getElementById('goal-text').textContent = `GOAL = $${cur.toFixed(2)}/$${target.toFixed(0)}`;

  const pct = Math.min(100, Math.max(0, (cur / target) * 100));
  document.getElementById('goal-progress-bar').style.width = `${pct}%`;
}

// Activity Banner Event Queue
function queueEvent(evt) {
  eventQueue.push(evt);
  if (!isDisplayingEvent) {
    displayNextEvent();
  }
}

function displayNextEvent() {
  if (eventQueue.length === 0) {
    isDisplayingEvent = false;
    return;
  }

  isDisplayingEvent = true;
  const evt = eventQueue.shift();

  const banner = document.getElementById('activity-banner');
  const levelEl = document.getElementById('activity-level');
  const userEl = document.getElementById('activity-user');
  const countryEl = document.getElementById('activity-country');
  const pointsEl = document.getElementById('activity-points');

  // Configure text according to event type
  if (evt.type === 'like') {
    levelEl.textContent = 'LIKE';
    levelEl.style.color = '#00E5FF';
    userEl.textContent = 'Stream Likes';
    countryEl.textContent = evt.country;
    pointsEl.textContent = `+${evt.points}`;
    pointsEl.className = 'activity-points bonus';
  } else if (evt.type === 'superchat') {
    levelEl.textContent = 'SUPERCHAT';
    levelEl.style.color = '#FFE600';
    userEl.textContent = evt.user;
    countryEl.textContent = evt.country;
    pointsEl.textContent = `+${evt.points.toLocaleString()} ($${evt.usd.toFixed(2)})`;
    pointsEl.className = 'activity-points bonus';
    playSuperchatFanfare();
    spawnPodiumSparkles();
  } else {
    // Normal chat or bonus
    levelEl.textContent = `Level ${evt.level || 1}`;
    levelEl.style.color = '#FFE600';
    userEl.textContent = evt.user;
    countryEl.textContent = evt.country;
    if (evt.isBonus) {
      pointsEl.textContent = `BONUS +${evt.points}`;
      pointsEl.className = 'activity-points bonus';
    } else {
      pointsEl.textContent = `+${evt.points}`;
      pointsEl.className = 'activity-points';
    }
    playPopSound();
  }

  // Pop animation
  banner.classList.remove('pop');
  void banner.offsetWidth; // Trigger reflow
  banner.classList.add('pop');

  // Spawn floating tag over tile if in grid
  if (evt.code) {
    spawnFloatingTileTag(evt.code.toLowerCase(), evt.user, evt.points);
  }

  // Minimum 800ms display time per event
  setTimeout(() => {
    displayNextEvent();
  }, 850);
}

// Active tile tags map: countryCode -> { tagEl, timer, flagWrap, tile }
const activeTileTags = new Map();

// Spawn floating chatter tag over specific country flag in grid
function spawnFloatingTileTag(countryCode, userName, points) {
  const code = (countryCode || '').toLowerCase();
  if (!code) return;

  // 1. Locate container: check grid tile first, then podium
  let container = document.querySelector(`.flag-tile[data-code="${code}"]`);
  let flagWrap = container ? container.querySelector('.tile-flag-wrap') : null;
  let scoreEl = container ? container.querySelector('.tile-score') : null;

  // If not in grid, check podium
  if (!container) {
    if (countriesData[0]?.code.toLowerCase() === code) {
      container = document.getElementById('podium-1');
      flagWrap = container ? container.querySelector('.podium-flag-box') : null;
      scoreEl = document.getElementById('podium-1-score');
      document.getElementById('podium-1-chatter').textContent = userName;
      spawnPodiumSparkles();
    } else if (countriesData[1]?.code.toLowerCase() === code) {
      container = document.getElementById('podium-2');
      flagWrap = container ? container.querySelector('.podium-flag-box') : null;
      scoreEl = document.getElementById('podium-2-score');
    } else if (countriesData[2]?.code.toLowerCase() === code) {
      container = document.getElementById('podium-3');
      flagWrap = container ? container.querySelector('.podium-flag-box') : null;
      scoreEl = document.getElementById('podium-3-score');
    }
  }

  if (!container) return;

  // Flash score on vote
  if (scoreEl) {
    scoreEl.classList.remove('flash');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('flash');
  }

  // 2. If country already has an active tag, smoothly update it and reset timer!
  if (activeTileTags.has(code)) {
    const existing = activeTileTags.get(code);
    clearTimeout(existing.timer);

    existing.tagEl.innerHTML = `<span class="tag-pts">+${points}</span><span class="tag-user">${userName}</span>`;
    existing.tagEl.classList.remove('pop-in', 'fade-out');
    void existing.tagEl.offsetWidth;
    existing.tagEl.classList.add('pop-in');

    if (existing.flagWrap) {
      existing.flagWrap.classList.remove('tag-highlight');
      void existing.flagWrap.offsetWidth;
      existing.flagWrap.classList.add('tag-highlight');
    }

    // Tag stays for 4.5 seconds until next name comes
    existing.timer = setTimeout(() => {
      existing.tagEl.classList.add('fade-out');
      if (existing.flagWrap) existing.flagWrap.classList.remove('tag-highlight');
      setTimeout(() => {
        existing.tagEl.remove();
        activeTileTags.delete(code);
      }, 450);
    }, 4500);
    return;
  }

  // 3. Create fresh tag
  const tag = document.createElement('div');
  tag.className = 'floating-chatter-tag pop-in';
  tag.innerHTML = `<span class="tag-pts">+${points}</span><span class="tag-user">${userName}</span>`;
  container.appendChild(tag);

  if (flagWrap) {
    flagWrap.classList.add('tag-highlight');
  }

  // Tag stays for 4.5 seconds until next name comes
  const timer = setTimeout(() => {
    tag.classList.add('fade-out');
    if (flagWrap) flagWrap.classList.remove('tag-highlight');
    setTimeout(() => {
      tag.remove();
      activeTileTags.delete(code);
    }, 450);
  }, 4500);

  activeTileTags.set(code, { tagEl: tag, timer, flagWrap, tile: container });
}

// Sparkle & Coin burst on podium
function spawnPodiumSparkles() {
  const container = document.getElementById('podium-particles');
  if (!container) return;

  const count = 14;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.textContent = Math.random() < 0.5 ? '✦' : '★';
    p.style.position = 'absolute';
    p.style.left = '50%';
    p.style.top = '50%';
    p.style.color = Math.random() < 0.5 ? '#FFE600' : '#00E5FF';
    p.style.fontSize = `${Math.floor(Math.random() * 16) + 14}px`;
    p.style.pointerEvents = 'none';
    p.style.zIndex = '10';

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 120 + 40;
    const destX = Math.cos(angle) * dist;
    const destY = Math.sin(angle) * dist - 40;

    container.appendChild(p);

    p.animate([
      { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 1 },
      { transform: `translate(calc(-50% + ${destX}px), calc(-50% + ${destY}px)) scale(1.3)`, opacity: 0 }
    ], {
      duration: 800 + Math.random() * 400,
      easing: 'ease-out'
    }).onfinish = () => p.remove();
  }
}

// Winner Announcement Modal
function handleRoundStatus(round) {
  if (round.winner) {
    showWinner(round.winner);
  } else {
    hideWinner();
  }
}

function showWinner(country) {
  const modal = document.getElementById('winner-modal');
  document.getElementById('winner-flag').src = `/flags/${country.code.toLowerCase()}.png`;
  document.getElementById('winner-name').textContent = country.name.toUpperCase();
  document.getElementById('winner-score').textContent = `${formatScore(country.score)} Points`;
  modal.classList.remove('hidden');
  playSuperchatFanfare();
}

function hideWinner() {
  const modal = document.getElementById('winner-modal');
  modal.classList.add('hidden');
}
