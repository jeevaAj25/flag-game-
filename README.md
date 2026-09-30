# 🚩 Live Flag Count Fight - YouTube Live Stream Scoreboard

A high-performance, real-time vertical (9:16, 1080x1920, 30/60 fps) interactive **Flag Count Fight** live stream app for YouTube. Viewers vote for their country by typing the country name in chat, sending Super Chats, liking the stream, or subscribing.

---

## 🌟 Key Features

- **Pixel-Accurate Reference Design**:
  - Dark royal navy blue gradient with soft cyber glows.
  - Header: `✦ BOOST YOUR COUNTRY ✦` with glowing golden stars.
  - Two neon action boxes: **1$ Superchat / Gift (+4000 Points)** (gold neon) and **Like & Subscribe (+400 Points)** (cyan neon).
  - Live activity banner: `Level N @Username Country +points` with pop animations and buffered queue.
  - Superchat members panel (`👥 SUPERCHAT MEMBERS`) & Goal progress bar (`🎯 GOAL = $3.08/$50`).
  - Top 2 Super Chat donor cards with ornate gold & cyan avatar frames and mini country flag badges pinned to the bottom-left corner.
  - 3-tier podium: #1 Center Gold Crown (with faint top chatter watermark), #2 Left Silver Crown, #3 Right Bronze Crown with smooth rank swap transitions.
  - 8-column flag grid with high-resolution country flags, bold formatted scores (`1,957`, `10k`, `51.7k`), and smooth FLIP reordering animations.
  - Floating chatter tags (`+1 @user`) over the active country flag tile.
  - Configurable bottom-right watermark (`PRISM Live` or custom text).
- **Comprehensive Country Dictionary (~240 Countries)**:
  - Supports ISO codes (`id`, `in`, `ph`, `us`, etc.), full names, popular aliases (`indo`, `bharat`, `pinoy`, `uk`, `america`, etc.), common typos (`idonesia`), and flag emojis (`🇮🇩`, `🇮🇳`, `🇵🇭`, `🇺🇸`).
- **Flexible Dual Streaming Modes**:
  - **Mode A (OBS Browser Source - Recommended)**: Serve overlay at `http://localhost:3000/overlay` (1080x1920) for crisp 60 fps rendering with zero extra GPU/CPU duplication.
  - **Mode B (Direct RTMP Pipeline)**: Built-in Headless Chrome + FFmpeg pipe streaming directly to `rtmp://a.rtmp.youtube.com/live2/<STREAM_KEY>` (x264, 30 fps, ~4500 kbps, keyframe every 2s, AAC audio).
- **Interactive Control Center (`/admin`)**:
  - Live country scoreboard editor (+10, +100, +1000, -500 points).
  - Round timer manager with automatic winner announcement screen (`🏆 WINNER: Indonesia 51.7k`) and 30-second new round countdown.
  - Goal amount and watermark editor.
  - One-click Simulator console for testing chats, Super Chats, likes, and subscribers without an active stream.
- **Robust Persistence & Anti-Spam**:
  - Local SQLite database (`better-sqlite3`) persists country scores, top donors, chatter levels, and idempotency event logs.
  - Configurable cooldowns (e.g. max 1 vote per user per 3s, max 20 per minute).
  - Hourly cached currency exchange rates for international Super Chats.

---

## 📊 Points System (Configurable in `config.json`)

| Event | Points | Scoring Logic |
| :--- | :--- | :--- |
| **Valid Country Chat** | **+1 point** | Rate-limited to max 1 per user every 3 seconds (anti-spam). |
| **Super Chat / Gift** | **+4000 points / $1** | Converted to USD via exchange rate API. Credited to country in message or user's last voted country. Top donors shown in Superchat Members panel. |
| **Stream Likes** | **+400 points each** | Polled every 10s from video statistics. Distributed based on `LIKE_MODE` (`active_split`, `top_country`, or `last_chatter`). |
| **New Subscriber** | **+400 points** | Polled from channel subscriptions. Matched to chat user or held in pending pool for 10 minutes. |

---

## 🚀 Quick Start

### 1. Installation
Ensure Node.js (v18+) is installed. Clone or navigate to the directory:
```bash
cd D:\project\flaggamess
npm install
```

### 2. Start the Server
```bash
npm start
```

### 3. Open the Overlay & Admin Panel
- **Scoreboard Overlay**: [http://localhost:3000/overlay](http://localhost:3000/overlay)
- **Admin Control Center**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 🎥 Streaming Setup

### Option 1: OBS Studio Browser Source (Recommended)
1. Open OBS Studio.
2. In **Settings > Video**, set Canvas and Output resolutions to `1080x1920`.
3. Add a **Browser Source**:
   - URL: `http://localhost:3000/overlay`
   - Width: `1080`
   - Height: `1920`
4. Enter your YouTube Stream Key in OBS and click **Start Streaming**.

### Option 2: Direct RTMP Pipeline (Headless Chrome + FFmpeg)
1. Open the Admin Panel at `http://localhost:3000/admin`.
2. Enter your YouTube Stream Key in the RTMP panel.
3. Click **▶ Start RTMP Stream**.
4. The server automatically launches headless Google Chrome at 1080x1920 and pipes 30 fps frames to FFmpeg, pushing to `rtmp://a.rtmp.youtube.com/live2/<STREAM_KEY>`.

---

## ⚙️ Configuration (`config.json`)

```json
{
  "server": {
    "port": 3000
  },
  "points": {
    "pointsPerUsd": 4000,
    "pointsPerLike": 400,
    "pointsPerSubscribe": 400,
    "pointsPerChat": 1
  },
  "game": {
    "likeMode": "active_split",
    "chatCooldownMs": 3000,
    "maxChatsPerMin": 20,
    "goalAmount": 50.0,
    "currentGoalAmount": 3.08,
    "roundDurationMinutes": 0,
    "watermarkText": "PRISM Live",
    "watermarkEnabled": true
  },
  "youtube": {
    "streamKey": "",
    "rtmpUrl": "rtmp://a.rtmp.youtube.com/live2",
    "videoId": "",
    "liveChatId": "",
    "apiKey": "",
    "clientId": "",
    "clientSecret": "",
    "refreshToken": ""
  },
  "stream": {
    "fps": 30,
    "bitrate": "4500k",
    "width": 1080,
    "height": 1920,
    "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "ffmpegPath": "ffmpeg"
  }
}
```

---

## 🧪 Testing with the Built-in Simulator

No YouTube stream key or live stream required to test!
1. Go to `http://localhost:3000/admin`.
2. Under **Live Simulator**, click **▶ Start Auto Live Traffic**.
3. Watch the scoreboard overlay at `http://localhost:3000/overlay` react live to incoming chat votes, Super Chats, likes, and subscribers.
4. Use one-click simulation buttons to trigger specific events:
   - Chat votes for Indonesia, India, Philippines, USA, Saudi Arabia, Greece.
   - Super Chats ($2.67, $5.00) with celebration fanfare.
   - +10 Like batches and new subscribers.

---

## 📁 Project Structure

```
flaggamess/
├── config.json              # Main app configuration
├── .env.example             # Optional environment variable template
├── package.json             # NPM dependencies & scripts
├── SETUP_GUIDE.md           # Step-by-step Google Cloud & OBS setup guide
├── README.md                # Project documentation
├── data/
│   └── game.db              # SQLite persistence database (scores, donors, users)
├── src/
│   ├── index.js             # Main CLI runner
│   ├── server.js            # Express & WebSocket coordination server
│   ├── db.js                # SQLite database queries & anti-spam logic
│   ├── countries.js         # Dictionary of ~240 countries, aliases, and matcher
│   ├── youtube.js           # YouTube Data API v3 polling service
│   ├── currency.js          # Hourly cached currency exchange rates
│   ├── simulator.js         # Traffic & live chat simulator
│   └── streamer.js          # Puppeteer & FFmpeg direct RTMP pipeline
└── public/
    ├── overlay.html         # 1080x1920 vertical scoreboard overlay
    ├── overlay.css          # Pixel-accurate styling matching reference screenshots
    ├── overlay.js           # Live animations, FLIP grid, event queue, sound FX
    ├── admin.html           # Interactive Admin control center
    ├── admin.css            # Admin panel styling
    ├── admin.js             # Admin interactivity and live controls
    ├── flags/               # Bundled country flags (125+ countries)
    └── assets/              # SVG crowns, laurels, avatar frames, default avatars
```

---

## 🛠️ Troubleshooting

- **Scores reset on server restart?**
  Scores are safely stored in SQLite at `data/game.db`. If you ever want to re-seed to the default starting scores, click **Reset All Scores** in the Admin Panel.
- **Port 3000 already in use?**
  Change `"port": 3000` to another port (e.g. `3001`) in `config.json` or run `PORT=3001 npm start`.
- **Chrome path not found for direct RTMP mode?**
  The streamer automatically detects standard Windows Google Chrome and Microsoft Edge paths. You can also customize `"chromePath"` in `config.json`.
- **FFmpeg not found?**
  Ensure `ffmpeg` is added to your Windows system PATH (can be tested by running `ffmpeg -version` in PowerShell).
