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

    // YouTube Stream & API Keys status
    if (data.youtube) {
      if (data.youtube.videoId) {
        document.getElementById('input-video-id').value = data.youtube.videoId;
      }
      const streamKeyInput = document.getElementById('input-stream-key');
      if (streamKeyInput && data.youtube.streamKey) {
        streamKeyInput.value = data.youtube.streamKey;
      }

      const primaryBadge = document.getElementById('badge-primary-key');
      const primaryInput = document.getElementById('input-api-key');
      if (primaryInput && data.youtube.apiKey) {
        primaryInput.value = data.youtube.apiKey;
      }
      if (data.youtube.hasApiKey) {
        if (primaryBadge) {
          primaryBadge.textContent = data.youtube.activeKeyIndex === 1 ? '● Active (Configured ✓)' : 'Configured (✓)';
          primaryBadge.style.color = data.youtube.activeKeyIndex === 1 ? '#00E676' : '#FFE600';
        }
      } else {
        if (primaryBadge) {
          primaryBadge.textContent = 'Not set';
          primaryBadge.style.color = '#ff5252';
        }
      }

      const backupBadge = document.getElementById('badge-backup-key');
      const backupInput = document.getElementById('input-backup-api-key');
      if (backupInput && data.youtube.backupApiKey) {
        backupInput.value = data.youtube.backupApiKey;
      }
      if (data.youtube.hasBackupApiKey) {
        if (backupBadge) {
          backupBadge.textContent = data.youtube.activeKeyIndex === 2 ? '● Active (Failover ✓)' : 'Ready (Standby ✓)';
          backupBadge.style.color = data.youtube.activeKeyIndex === 2 ? '#00E676' : '#00E5FF';
        }
      } else {
        if (backupBadge) {
          backupBadge.textContent = 'Not set (Optional)';
          backupBadge.style.color = '#888';
        }
      }
    }

    // Boost state and settings
    if (data.boost) {
      updateBoostUI(data.boost);
      if (data.boost.intervalMinutes) document.getElementById('input-boost-interval').value = data.boost.intervalMinutes;
      if (data.boost.durationSeconds) document.getElementById('input-boost-duration').value = data.boost.durationSeconds;
      if (data.boost.autoEnabled !== undefined) {
        document.getElementById('select-boost-auto').value = data.boost.autoEnabled ? 'true' : 'false';
      }
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

    case 'BOOST_STATUS':
      updateBoostUI(msg.data);
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
  const boostTag = evt.is2x ? ' <span style="color: #FF1744; font-weight: 800;">[2X BOOST]</span>' : '';
  if (evt.type === 'boost_start' || evt.type === 'boost') {
    entry.innerHTML = `[${time}] 🔥 <strong style="color: #FFE600;">2X BOOST</strong>: ${evt.message || '2X Multiplier activated!'}`;
  } else if (evt.type === 'boost_end') {
    entry.innerHTML = `[${time}] ⚡ <strong>BOOST OVER</strong>: ${evt.message || 'Back to standard 1X points'}`;
  } else if (evt.type === 'superchat') {
    entry.innerHTML = `[${time}] 💰 <strong>SUPERCHAT</strong>${boostTag}: ${evt.user} gave $${evt.usd.toFixed(2)} (+${evt.points.toLocaleString()} pts) to <strong>${evt.country}</strong>`;
  } else if (evt.type === 'like') {
    entry.innerHTML = `[${time}] 👍 <strong>LIKE BATCH</strong>${boostTag}: +${evt.points} pts credited to <strong>${evt.country}</strong>`;
  } else if (evt.type === 'subscribe') {
    entry.innerHTML = `[${time}] 🔔 <strong>NEW SUBSCRIBER</strong>${boostTag}: ${evt.user} (+${evt.points} pts) to <strong>${evt.country}</strong>`;
  } else {
    entry.innerHTML = `[${time}] 💬 <strong>CHAT</strong>${boostTag}: ${evt.user} voted for <strong>${evt.country}</strong> (+${evt.points} pts)`;
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
async function startStream(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const streamKey = (document.getElementById('input-stream-key')?.value || '').trim();
  const btnStart = document.getElementById('btn-start-stream');
  if (btnStart) {
    btnStart.disabled = true;
    btnStart.textContent = '⏳ Starting Stream...';
  }

  try {
    const res = await fetch('/api/admin/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', streamKey })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Server error starting stream');
    alert('✅ Stream started successfully!');
  } catch (err) {
    alert('❌ Failed to start stream: ' + err.message);
  } finally {
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.textContent = '🔴 GO LIVE NOW';
    }
  }
}

async function stopStream(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const btnStop = document.getElementById('btn-stop-stream');
  if (btnStop) {
    btnStop.disabled = true;
    btnStop.textContent = '⏳ Stopping...';
  }

  try {
    const res = await fetch('/api/admin/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Server error stopping stream');
    alert('⏹ Stream stopped.');
  } catch (err) {
    alert('❌ Failed to stop stream: ' + err.message);
  } finally {
    if (btnStop) {
      btnStop.disabled = false;
      btnStop.textContent = '⏹ Stop Stream';
    }
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
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.textContent = '🔴 LIVE ACTIVE';
    }
    if (btnStop) btnStop.disabled = false;
  } else {
    dot.className = 'dot dot-stopped';
    text.textContent = 'Stream Stopped';
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.textContent = '🔴 GO LIVE NOW';
    }
    if (btnStop) btnStop.disabled = true;
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

// 2X Boost UI Handlers
function updateBoostUI(boost) {
  if (!boost) return;
  const badge = document.getElementById('admin-boost-badge');
  const multBadge = document.getElementById('admin-boost-multiplier');
  const btnTrigger = document.getElementById('btn-trigger-boost');
  const btnStop = document.getElementById('btn-stop-boost');

  if (boost.active) {
    if (badge) {
      badge.textContent = `🔥 2X BOOST ACTIVE (${boost.remainingSeconds}s remaining)`;
      badge.style.color = '#FF1744';
    }
    if (multBadge) {
      multBadge.textContent = '2X BOOST';
      multBadge.style.background = '#FF1744';
      multBadge.style.color = '#FFF';
    }
    if (btnTrigger) btnTrigger.disabled = true;
    if (btnStop) btnStop.disabled = false;
  } else {
    const nextSecs = Math.max(0, boost.nextBoostSeconds || 0);
    const mins = Math.floor(nextSecs / 60);
    const secs = nextSecs % 60;
    if (badge) {
      badge.textContent = `⏳ Next 2X Boost in: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      badge.style.color = '#FFE600';
    }
    if (multBadge) {
      multBadge.textContent = '1X';
      multBadge.style.background = '#FFE600';
      multBadge.style.color = '#000';
    }
    if (btnTrigger) btnTrigger.disabled = false;
    if (btnStop) btnStop.disabled = true;
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

  // Save Stream Config (with Primary & Backup YouTube API Keys)
  async function saveStreamConfig(e) {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    const btn = document.getElementById('btn-save-stream-config');
    const feedback = document.getElementById('save-stream-feedback');
    const oldText = btn ? btn.textContent : '💾 Save Settings';

    const streamKey = (document.getElementById('input-stream-key')?.value || '').trim();
    const videoId = (document.getElementById('input-video-id')?.value || '').trim();
    const apiKey = (document.getElementById('input-api-key')?.value || '').trim();
    const backupApiKey = (document.getElementById('input-backup-api-key')?.value || '').trim();

    const payload = { videoId };
    if (streamKey) payload.streamKey = streamKey;
    if (apiKey) payload.apiKey = apiKey;
    if (backupApiKey) payload.backupApiKey = backupApiKey;

    if (btn) {
      btn.disabled = true;
      btn.textContent = '💾 Saving...';
    }

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        // Retain input values so user can see and verify their keys
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.background = 'rgba(0, 230, 118, 0.15)';
          feedback.style.color = '#00E676';
          feedback.style.border = '1px solid rgba(0, 230, 118, 0.4)';
          feedback.textContent = '✅ Settings saved successfully!';
          setTimeout(() => { feedback.style.display = 'none'; }, 4000);
        }

        if (btn) {
          btn.textContent = '✅ Saved!';
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = oldText;
          }, 1500);
        }

        await loadInitialState();
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (err) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(255, 23, 68, 0.15)';
        feedback.style.color = '#FF1744';
        feedback.style.border = '1px solid rgba(255, 23, 68, 0.4)';
        feedback.textContent = '❌ Error saving: ' + err.message;
      }
      alert('Error saving settings: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
  }

  const btnSaveStream = document.getElementById('btn-save-stream-config');
  if (btnSaveStream) {
    btnSaveStream.addEventListener('click', saveStreamConfig);
  }

  const btnStartStream = document.getElementById('btn-start-stream');
  if (btnStartStream) {
    btnStartStream.addEventListener('click', startStream);
  }

  const btnStopStream = document.getElementById('btn-stop-stream');
  if (btnStopStream) {
    btnStopStream.addEventListener('click', stopStream);
  }

  // Prevent default submit/refresh on Enter and auto-save in credential inputs
  ['input-stream-key', 'input-video-id', 'input-api-key', 'input-backup-api-key'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveStreamConfig(e);
        }
      });
    }
  });

  // Toggle Primary API Key visibility
  const btnToggleApiKey = document.getElementById('btn-toggle-api-key');
  if (btnToggleApiKey) {
    btnToggleApiKey.addEventListener('click', (e) => {
      if (e) e.preventDefault();
      const input = document.getElementById('input-api-key');
      input.type = input.type === 'password' ? 'text' : 'password';
      btnToggleApiKey.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  }

  // Toggle Backup API Key visibility
  const btnToggleBackupApiKey = document.getElementById('btn-toggle-backup-api-key');
  if (btnToggleBackupApiKey) {
    btnToggleBackupApiKey.addEventListener('click', (e) => {
      if (e) e.preventDefault();
      const input = document.getElementById('input-backup-api-key');
      input.type = input.type === 'password' ? 'text' : 'password';
      btnToggleBackupApiKey.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  }

  // Test Primary YouTube API Key
  const btnTestApiKey = document.getElementById('btn-test-api-key');
  if (btnTestApiKey) {
    btnTestApiKey.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      const apiKey = document.getElementById('input-api-key').value.trim();
      const videoId = document.getElementById('input-video-id').value.trim();
      btnTestApiKey.disabled = true;
      btnTestApiKey.textContent = 'Testing...';
      try {
        const res = await fetch('/api/admin/youtube/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey || undefined, videoId, keyType: 'primary' })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
        } else {
          alert('❌ Primary Key Error: ' + (data.error || 'Failed to authenticate'));
        }
      } catch (err) {
        alert('Failed to test key: ' + err.message);
      } finally {
        btnTestApiKey.disabled = false;
        btnTestApiKey.textContent = 'Test Primary';
      }
    });
  }

  // Test Backup YouTube API Key
  const btnTestBackupApiKey = document.getElementById('btn-test-backup-api-key');
  if (btnTestBackupApiKey) {
    btnTestBackupApiKey.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      const backupApiKey = document.getElementById('input-backup-api-key').value.trim();
      const videoId = document.getElementById('input-video-id').value.trim();
      btnTestBackupApiKey.disabled = true;
      btnTestBackupApiKey.textContent = 'Testing...';
      try {
        const res = await fetch('/api/admin/youtube/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: backupApiKey || undefined, videoId, keyType: 'backup' })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
        } else {
          alert('❌ Backup Key Error: ' + (data.error || 'Failed to authenticate'));
        }
      } catch (err) {
        alert('Failed to test backup key: ' + err.message);
      } finally {
        btnTestBackupApiKey.disabled = false;
        btnTestBackupApiKey.textContent = 'Test Backup';
      }
    });
  }

  // Trigger 2X Boost
  const btnTriggerBoost = document.getElementById('btn-trigger-boost');
  if (btnTriggerBoost) {
    btnTriggerBoost.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      const duration = parseInt(document.getElementById('input-boost-duration').value, 10) || 60;
      await fetch('/api/admin/boost/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration })
      });
    });
  }

  // Stop 2X Boost
  const btnStopBoost = document.getElementById('btn-stop-boost');
  if (btnStopBoost) {
    btnStopBoost.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      await fetch('/api/admin/boost/stop', { method: 'POST' });
    });
  }

  // Double All Scores
  const btnDoubleScores = document.getElementById('btn-double-scores');
  if (btnDoubleScores) {
    btnDoubleScores.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      if (confirm('Multiply all current country scores by 2?')) {
        await fetch('/api/admin/boost/double-scores', { method: 'POST' });
      }
    });
  }

  // Save Boost Config
  const btnSaveBoost = document.getElementById('btn-save-boost-config');
  if (btnSaveBoost) {
    btnSaveBoost.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      const intervalMinutes = parseInt(document.getElementById('input-boost-interval').value, 10) || 10;
      const durationSeconds = parseInt(document.getElementById('input-boost-duration').value, 10) || 60;
      const autoEnabled = document.getElementById('select-boost-auto').value === 'true';
      await fetch('/api/admin/boost/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes, durationSeconds, autoEnabled })
      });
      alert('2X Boost settings saved! Auto-triggers every ' + intervalMinutes + ' mins.');
    });
  }

  // Save Goal Target & Current
  const btnSaveGoal = document.getElementById('btn-save-goal');
  if (btnSaveGoal) {
    btnSaveGoal.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      const target = parseFloat(document.getElementById('input-goal-target').value);
      const current = parseFloat(document.getElementById('input-goal-current').value);
      await fetch('/api/admin/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, current })
      });
      alert('Goal settings updated!');
    });
  }

  // Start & End Round
  const btnStartRound = document.getElementById('btn-start-round');
  if (btnStartRound) {
    btnStartRound.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      const durationMinutes = parseInt(document.getElementById('input-round-minutes').value, 10) || 10;
      await fetch('/api/admin/round/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMinutes })
      });
    });
  }

  const btnEndRound = document.getElementById('btn-end-round');
  if (btnEndRound) {
    btnEndRound.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      await fetch('/api/admin/round/end', { method: 'POST' });
    });
  }

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
    btnSaveBgm.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
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
      } catch (err) {
        alert('Failed to update audio: ' + err.message);
      }
    });
  }

  // Reset Scores
  const btnReset = document.getElementById('btn-reset-scores');
  if (btnReset) {
    btnReset.addEventListener('click', async (e) => {
      if (e) e.preventDefault();
      if (confirm('Are you sure you want to reset all country scores to starting numbers?')) {
        await fetch('/api/admin/reset', { method: 'POST' });
      }
    });
  }
}
