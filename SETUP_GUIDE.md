# Complete Setup & Configuration Guide

This guide walks you step-by-step through setting up Google Cloud API credentials, finding your YouTube Stream Key and Video ID, configuring OBS Studio, and running the live streaming pipeline.

---

## Table of Contents
1. [Google Cloud & YouTube Data API v3 Setup](#1-google-cloud--youtube-data-api-v3-setup)
2. [Obtaining OAuth2 Credentials](#2-obtaining-oauth2-credentials)
3. [Finding Your YouTube Stream Key & Video ID](#3-finding-your-youtube-stream-key--video-id)
4. [Mode A: OBS Studio Browser Source (Recommended)](#4-mode-a-obs-studio-browser-source-recommended)
5. [Mode B: Direct RTMP Streaming with Headless Chrome & FFmpeg](#5-mode-b-direct-rtmp-streaming-with-headless-chrome--ffmpeg)
6. [API Quota Handling & Best Practices](#6-api-quota-handling--best-practices)
7. [Testing with the Built-in Simulator](#7-testing-with-the-built-in-simulator)

---

## 1. Google Cloud & YouTube Data API v3 Setup

To allow the app to read live chat messages, Super Chats, likes, and subscribers:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** > **New Project**, name it `FlagFightLive`, and click **Create**.
3. In the left navigation menu, go to **APIs & Services** > **Library**.
4. Search for `YouTube Data API v3`.
5. Click on it and click **Enable**.

### Generating an API Key (for Chat & Likes):
1. In Google Cloud Console, navigate to **APIs & Services** > **Credentials**.
2. Click **+ CREATE CREDENTIALS** > **API key**.
3. Copy your API Key and paste it into `config.json` under `"apiKey"` (or set `YOUTUBE_API_KEY` in `.env`).

---

## 2. Obtaining OAuth2 Credentials

OAuth2 is required for reading channel subscribers (`subscriptions.list`) and full live chat capabilities on owner channels.

1. In Google Cloud Console, go to **APIs & Services** > **OAuth consent screen**:
   - User Type: Select **External** > Click **Create**.
   - App Name: `Flag Fight Live Stream`.
   - User support email: Select your email.
   - Developer contact email: Enter your email.
   - Click **Save and Continue**.
   - Under **Scopes**: Click **Add or Remove Scopes**, add:
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/youtube`
   - Under **Test Users**: Add your YouTube account email address.
   - Click **Save and Continue**.

2. Go to **APIs & Services** > **Credentials**:
   - Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
   - Application type: Select **Web application**.
   - Name: `Flag Fight Web Client`.
   - **Authorized redirect URIs**: Add:
     `http://localhost:3000/oauth2callback`
   - Click **Create**.
3. Copy the **Client ID** and **Client Secret** into `config.json`:
   ```json
   "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
   "clientSecret": "YOUR_CLIENT_SECRET"
   ```
4. Start the app: `npm start`.
5. Open your browser and authorize your channel. The app will automatically capture your `refreshToken` and save it to `config.json`.

---

## 3. Finding Your YouTube Stream Key & Video ID

1. Go to [YouTube Studio Live](https://studio.youtube.com/channel/live).
2. Click **Schedule Stream** or **Go Live**.
3. Set stream orientation to **Vertical (9:16)**:
   - Resolution: `1080 x 1920`.
4. In the stream settings tab:
   - **Stream Key**: Copy your stream key (e.g. `xxxx-xxxx-xxxx-xxxx`) and paste it into `config.json` under `"streamKey"` or in the Admin Control Panel.
   - **Stream URL**: Default is `rtmp://a.rtmp.youtube.com/live2`.
5. In the top right, copy the stream link (e.g. `https://youtube.com/watch?v=l2t_V1s2Bc`).
   - The **Video ID** is the part after `v=`, e.g. `l2t_V1s2Bc`.
   - Put this in `config.json` under `"videoId"`.

---

## 4. Mode A: OBS Studio Browser Source (Recommended)

This is the most lightweight, zero-latency, and GPU-efficient way to stream on Windows:

1. Launch **OBS Studio**.
2. Go to **Settings** > **Video**:
   - **Base (Canvas) Resolution**: `1080x1920` (or select portrait format).
   - **Output (Scaled) Resolution**: `1080x1920`.
   - **Common FPS Values**: `30` or `60`.
3. In your OBS Scene, click **+ (Add Source)** > **Browser**:
   - **Name**: `Flag Scoreboard Overlay`.
   - **URL**: `http://localhost:3000/overlay`
   - **Width**: `1080`
   - **Height**: `1920`
   - Check **Control audio via OBS** (optional, if you want sound effects).
   - Click **OK**.
4. In OBS Settings > **Stream**:
   - Service: `YouTube - RTMPS`.
   - Paste your YouTube Stream Key.
   - Click **Start Streaming** in OBS!

---

## 5. Mode B: Direct RTMP Streaming with Headless Chrome & FFmpeg

If you prefer to stream directly from the Node.js server without OBS:

1. Ensure **FFmpeg** is installed and in your PATH (already verified).
2. Enter your Stream Key in `config.json` or open the Admin Panel at:
   `http://localhost:3000/admin`
3. Enter your Stream Key in the RTMP panel and click **▶ Start RTMP Stream**.
4. Headless Google Chrome will launch at 1080x1920, pipe frames at 30 fps directly to FFmpeg with x264 (4500 kbps, keyframe every 2s, AAC audio), and push directly to:
   `rtmp://a.rtmp.youtube.com/live2/<STREAM_KEY>`

---

## 6. API Quota Handling & Best Practices

YouTube Data API v3 provides 10,000 free quota units per day:
- `liveChatMessages.list`: 5 units per request.
- `videos.list` (statistics): 1 unit per request.
- `subscriptions.list`: 1 unit per request.

### Built-in Quota Protections in this app:
1. **Dynamic Polling**: Strictly uses `pollingIntervalMillis` returned by YouTube (usually 2,500ms to 4,000ms). Never polls faster than allowed.
2. **Exponential Backoff**: If rate limits or network errors occur, the poller automatically backs off up to 30 seconds before retrying.
3. **Idempotency Deduplication**: Every processed message ID, Super Chat ID, and subscription ID is logged in SQLite (`data/game.db`). Restarting the app never re-counts old events or consumes extra quota.
4. **Hourly Cached Exchange Rates**: Currency conversion runs against cached hourly rates, eliminating redundant network calls.

---

## 7. Testing with the Built-in Simulator

You can test the entire scoreboard, animations, sound effects, and donor leaderboards without a live stream or spending money:

1. Open `http://localhost:3000/admin`.
2. Click **▶ Start Auto Live Traffic**.
   - The simulator will generate real live chat traffic bursts, random Super Chats, likes, and subscribers.
3. Watch the overlay at `http://localhost:3000/overlay` live re-order ranks, pop activity banners, and trigger gold/cyan celebrations!
