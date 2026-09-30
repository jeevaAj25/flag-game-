// Admin Control Center Client Logic
let socket = null;
let allCountries = [];
let isTrafficRunning = false;
let roundRemainingSec = 0;
let roundCountdownInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  const obsInput = document.getElementById('obs-url');
  if (obsInput) {
    obsInput.value = `${window.location.origin}/overlay`;
  }
  connectWebSocket();
  setupEventListeners();
  loadInitialState();
  startStreamStatusPoller();
});

// Initial Fetch
async function loadInitialState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    allCountries = data.countries || [];
    renderCountryTable();

    // Goal
    if (data.goal) {
      document.getElementById('input-goal-current').value = data.goal.current;
      document.getElementById('input-goal-target').value = data.goal.target;
    }

    // Watermark
    if (data.settings) {
      document.getElementById('input-watermark-text').value = data.settings.watermarkText || 'PRISM Live';
      document.getElementById('select-watermark-enabled').value = data.settings.watermarkEnabled ? 'true' : 'false';
    }

    // Background Music
    if (data.audio) {
      const vol = Math.round((data.audio.bgmVolume ?? 0.7) * 100);
      const inputVol = document.getElementById('input-bgm-volume');
      const labelVol = document.getElementById('label-bgm-volume');
      const selectEnabled = document.getElementById('select-bgm-enabled');
      if (inputVol) inputVol.value = vol;
      if (labelVol) labelVol.textContent = vol + '%';
      if (selectEnabled) selectEnabled.value = data.audio.bgmEnabled !== false ? 'true' : 'false';
    }

    // Simulator
    updateTrafficButton(data.simulatorRunning);

    // Stream
    updateStreamUI(data.stream);

    // YouTube Stream config
    if (data.youtube) {
      if (data.youtube.streamKey) document.getElementById('input-stream-key').value = data.youtube.streamKey;
      if (data.youtube.videoId) document.getElementById('input-video-id').value = data.youtube.videoId;
    }

    // Round
    if (data.round && data.round.active) {
      startRoundCountdown(data.round.remainingSeconds);
    }
  } catch (e) {
    console.error('Failed to load initial state:', e);
  }
}

// WebSocket Connection
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}`;
  socket = new WebSocket(url);

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error(e);
    }
  };

  socket.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'SCORES_UPDATE':
      allCountries = msg.data;
      renderCountryTable();
      break;

    case 'ACTIVITY_EVENT':
      appendLog(msg.data);
      break;

    case 'STREAM_STATUS':
      updateStreamUI(msg.data);
      break;

    case 'ROUND_STATUS':
      if (msg.data.active) {
        startRoundCountdown(msg.data.remainingSeconds);
      } else {
        stopRoundCountdown(msg.data.winner);
      }
      break;
  }
}

// Render Country Table
function renderCountryTable() {
  const tbody = document.getElementById('country-table-body');
  const query = (document.getElementById('country-search').value || '').toLowerCase().trim();

  const filtered = allCountries.filter(c => 
    !query || c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)
  );

  tbody.innerHTML = '';
  filtered.forEach((c, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td>
        <div class="country-cell">
          <img src="/flags/${c.code.toLowerCase()}.png" class="country-table-flag" onerror="this.src='https://flagcdn.com/w160/${c.code.toLowerCase()}.png'">
          <span>${c.name} (${c.code.toUpperCase()})</span>
        </div>
      </td>
      <td><strong>${(c.score || 0).toLocaleString()}</strong></td>
      <td>
        <button class="btn-mini-boost" onclick="addPoints('${c.code}', 10)">+10</button>
        <button class="btn-mini-boost" onclick="addPoints('${c.code}', 100)">+100</button>
        <button class="btn-mini-boost" onclick="addPoints('${c.code}', 1000)">+1K</button>
        <button class="btn-mini-boost" onclick="addPoints('${c.code}', -500)">-500</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function addPoints(code, points) {
  try {
    await fetch('/api/admin/points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, points, chatterName: 'Admin Boost' })
    });
  } catch (e) {
    alert('Error boosting points: ' + e.message);
  }
}

// Event Log
function appendLog(evt) {
  const container = document.getElementById('event-log-container');
  const entry = document.createElement('div');
  entry.className = `log-entry log-${evt.type || 'chat'}`;

  const time = new Date().toLocaleTimeString();
  if (evt.type === 'superchat') {
    entry.innerHTML = `[${time}] 💰 <strong>SUPERCHAT</strong>: ${evt.user} gave $${evt.usd.toFixed(2)} (+${evt.points.toLocaleString()} pts) to <strong>${evt.country}</strong>`;
  } else if (evt.type === 'like') {
    entry.innerHTML = `[${time}] 👍 <strong>LIKE BATCH</strong>: +${evt.points} pts credited to <strong>${evt.country}</strong>`;
  } else if (evt.type === 'subscribe') {
    entry.innerHTML = `[${time}] 🔔 <strong>NEW SUBSCRIBER</strong>: ${evt.user} (+${evt.points} pts) to <strong>${evt.country}</strong>`;
  } else {
    entry.innerHTML = `[${time}] 💬 <strong>CHAT</strong>: ${evt.user} voted for <strong>${evt.country}</strong> (+${evt.points} pts)`;
  }

  container.prepend(entry);
  if (container.children.length > 50) {
    container.lastChild.remove();
  }
}

// Simulator Callbacks
async function simulateChat(countryCode) {
  await fetch('/api/admin/simulate/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: countryCode })
  });
}

async function simulateLevelChat(countryCode, level) {
  await fetch('/api/admin/simulate/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: countryCode, level: level })
  });
}

async function simulateSuperchat(usd, countryCode) {
  await fetch('/api/admin/simulate/superchat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usd, country: countryCode })
  });
}

async function simulateLike(count) {
  await fetch('/api/admin/simulate/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count })
  });
}

async function simulateSubscribe() {
  await fetch('/api/admin/simulate/subscribe', { method: 'POST' });
}

async function toggleTraffic() {
  const nextAction = isTrafficRunning ? 'stop' : 'start';
  const res = await fetch('/api/admin/simulate/traffic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: nextAction })
  });
  const data = await res.json();
  updateTrafficButton(data.running);
}

function updateTrafficButton(running) {
  isTrafficRunning = running;
  const btn = document.getElementById('btn-toggle-traffic');
  const status = document.getElementById('traffic-status');
  if (running) {
    btn.textContent = '⏹ Stop Auto Traffic';
    btn.className = 'btn-traffic-stop';
    status.textContent = 'Auto Traffic Active (simulating live viewers)';
    status.className = 'traffic-active';
  } else {
    btn.textContent = '▶ Start Auto Live Traffic';
    btn.className = 'btn-traffic-start';
    status.textContent = 'Simulator Idle';
    status.className = 'traffic-idle';
  }
}

// RTMP Stream Handlers
async function startStream() {
  const streamKey = document.getElementById('input-stream-key').value.trim();
  const btnStart = document.getElementById('btn-start-stream');
  btnStart.disabled = true;
  btnStart.textContent = 'Starting...';

  try {
    const res = await fetch('/api/admin/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', streamKey })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    alert('Failed to start stream: ' + e.message);
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = '▶ Start RTMP Stream';
  }
}

async function stopStream() {
  const btnStop = document.getElementById('btn-stop-stream');
  btnStop.disabled = true;
  btnStop.textContent = 'Stopping...';

  try {
    await fetch('/api/admin/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });
  } catch (e) {
    alert('Failed to stop stream: ' + e.message);
  } finally {
    btnStop.disabled = false;
    btnStop.textContent = '⏹ Stop Stream';
  }
}

function updateStreamUI(status) {
  if (!status) return;
  const isRunning = Boolean(status.running);
  const dot = document.getElementById('stream-dot');
  const text = document.getElementById('stream-text');
  const fps = document.getElementById('stream-fps');
  const uptime = document.getElementById('stream-uptime');
  const btnStart = document.getElementById('btn-start-stream');
  const btnStop = document.getElementById('btn-stop-stream');

  if (isRunning) {
    dot.className = 'dot dot-running';
    text.textContent = 'Live Streaming to YouTube';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    dot.className = 'dot dot-stopped';
    text.textContent = 'Stream Stopped';
    btnStart.disabled = false;
    btnStop.disabled = true;
  }

  if (status.fps !== undefined) fps.textContent = status.fps;
  if (status.uptimeSeconds !== undefined) uptime.textContent = `${status.uptimeSeconds}s`;
}

function startStreamStatusPoller() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/admin/stream/status');
      const data = await res.json();
      updateStreamUI(data);
    } catch (e) {}
  }, 3000);
}

// Round Timer Handlers
function startRoundCountdown(seconds) {
  roundRemainingSec = seconds;
  if (roundCountdownInterval) clearInterval(roundCountdownInterval);

  const display = document.getElementById('round-timer-display');
  roundCountdownInterval = setInterval(() => {
    if (roundRemainingSec <= 0) {
      clearInterval(roundCountdownInterval);
      display.textContent = 'ROUND OVER';
      return;
    }
    const mins = Math.floor(roundRemainingSec / 60);
    const secs = roundRemainingSec % 60;
    display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    roundRemainingSec--;
  }, 1000);
}

function stopRoundCountdown(winner) {
  if (roundCountdownInterval) clearInterval(roundCountdownInterval);
  const display = document.getElementById('round-timer-display');
  if (winner) {
    display.textContent = `WINNER: ${winner.name.toUpperCase()}`;
  } else {
    display.textContent = 'NO ROUND ACTIVE';
  }
}

// UI Event Listeners
function setupEventListeners() {
  // Search
  document.getElementById('country-search').addEventListener('input', renderCountryTable);

  // Copy OBS URL
  document.getElementById('btn-copy-obs').addEventListener('click', () => {
    const input = document.getElementById('obs-url');
    input.select();
    navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('btn-copy-obs');
    const oldText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = oldText; }, 1800);
  });

  // Traffic
  document.getElementById('btn-toggle-traffic').addEventListener('click', toggleTraffic);

  // Save Stream Config
  document.getElementById('btn-save-stream-config').addEventListener('click', async () => {
    const streamKey = document.getElementById('input-stream-key').value.trim();
    const videoId = document.getElementById('input-video-id').value.trim();
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamKey, videoId })
      });
      const data = await res.json();
      if (data.success) {
        alert('YouTube Stream settings saved!');
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Failed to save settings: ' + e.message);
    }
  });

  // Stream buttons
  document.getElementById('btn-start-stream').addEventListener('click', startStream);
  document.getElementById('btn-stop-stream').addEventListener('click', stopStream);

  // Round buttons
  document.getElementById('btn-start-round').addEventListener('click', async () => {
    const minutes = parseInt(document.getElementById('input-round-minutes').value, 10) || 10;
    const res = await fetch('/api/admin/round/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMinutes: minutes })
    });
    const data = await res.json();
    startRoundCountdown(data.remainingSeconds);
  });

  document.getElementById('btn-end-round').addEventListener('click', async () => {
    await fetch('/api/admin/round/end', { method: 'POST' });
  });

  // Save Goal
  document.getElementById('btn-save-goal').addEventListener('click', async () => {
    const current = parseFloat(document.getElementById('input-goal-current').value) || 0;
    const target = parseFloat(document.getElementById('input-goal-target').value) || 50;
    await fetch('/api/admin/goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, target })
    });
    alert('Goal settings updated!');
  });

  // Save Watermark
  document.getElementById('btn-save-watermark').addEventListener('click', async () => {
    const text = document.getElementById('input-watermark-text').value.trim();
    const enabled = document.getElementById('select-watermark-enabled').value === 'true';
    await fetch('/api/admin/watermark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, enabled })
    });
    alert('Watermark settings updated!');
  });

  // BGM Slider & Save
  const inputBgmVol = document.getElementById('input-bgm-volume');
  const labelBgmVol = document.getElementById('label-bgm-volume');
  if (inputBgmVol && labelBgmVol) {
    inputBgmVol.addEventListener('input', () => {
      labelBgmVol.textContent = inputBgmVol.value + '%';
    });
  }

  const btnSaveBgm = document.getElementById('btn-save-bgm');
  if (btnSaveBgm) {
    btnSaveBgm.addEventListener('click', async () => {
      const volume = (parseInt(inputBgmVol.value, 10) || 70) / 100;
      const enabled = document.getElementById('select-bgm-enabled').value === 'true';
      try {
        const res = await fetch('/api/admin/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume, enabled })
        });
        const data = await res.json();
        if (data.success) {
          alert('Background music settings updated!');
        }
      } catch (e) {
        alert('Failed to update audio: ' + e.message);
      }
    });
  }

  // Reset Scores
  document.getElementById('btn-reset-scores').addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all country scores to starting numbers?')) {
      await fetch('/api/admin/reset', { method: 'POST' });
    }
  });
}
