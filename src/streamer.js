// Direct RTMP Streaming Engine via Headless Chromium & FFmpeg
// Stream settings: 1080x1920 vertical, 30 fps, x264, 4500 kbps, AAC audio, keyframe every 2 sec

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class StreamerService {
  constructor(config, eventEmitter) {
    this.config = config;
    this.emitter = eventEmitter;
    this.browser = null;
    this.page = null;
    this.ffmpegProcess = null;
    this.isStreaming = false;
    this.client = null;
    this.frameCount = 0;
    this.startTime = 0;
    this.lastFrameBuffer = null;
    this.streamTimer = null;
  }

  findChromePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const configured = this.config.stream?.chromePath;
    if (configured && fs.existsSync(configured)) {
      return configured;
    }

    const standardPaths = [
      // Linux / Docker paths (AWS)
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
      // Windows paths
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];

    for (const p of standardPaths) {
      if (fs.existsSync(p)) return p;
    }

    // Attempt to use Puppeteer's bundled browser if available
    try {
      if (typeof puppeteer.executablePath === 'function') {
        const bundled = puppeteer.executablePath();
        if (bundled && fs.existsSync(bundled)) {
          return bundled;
        }
      }
    } catch (e) {}

    return null;
  }

  findFfmpegPath() {
    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
      return process.env.FFMPEG_PATH;
    }

    const configured = this.config.stream?.ffmpegPath;
    if (configured && configured !== 'ffmpeg' && fs.existsSync(configured)) {
      return configured;
    }

    const standardPaths = [
      // Linux / AWS paths
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      // Windows paths
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
    ];

    for (const p of standardPaths) {
      if (fs.existsSync(p)) return p;
    }
    return 'ffmpeg';
  }

  async startStream(customStreamKey = null) {
    if (this.isStreaming) {
      throw new Error('Stream is already running');
    }

    const streamKey = customStreamKey || this.config.youtube?.streamKey || process.env.STREAM_KEY;
    if (!streamKey) {
      throw new Error('No YouTube stream key provided in config.json or environment');
    }

    const rtmpUrl = (this.config.youtube?.rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/$/, '') + '/' + streamKey;
    const chromePath = this.findChromePath();

    console.log('[Streamer] Initializing headless Chrome' + (chromePath ? ` with path: ${chromePath}` : ' (using bundled Chromium)'));
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1080,1920',
        '--autoplay-policy=no-user-gesture-required'
      ]
    };
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }

    this.browser = await puppeteer.launch(launchOptions);

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

    const port = this.config.server?.port || 3000;
    const overlayUrl = `http://localhost:${port}/overlay?stream=1`;
    console.log('[Streamer] Navigating to overlay:', overlayUrl);
    await this.page.goto(overlayUrl, { waitUntil: 'networkidle2' });

    // Build FFmpeg arguments
    const fps = this.config.stream?.fps || 30;
    const bitrate = this.config.stream?.bitrate || '4500k';
    const ffmpegPath = this.findFfmpegPath();
    const publicBgm = path.join(__dirname, '..', 'public', 'sounds', 'bgm.mp3');
    const customBgm = this.config.audio?.bgmFile ? path.join(__dirname, '..', 'public', this.config.audio.bgmFile.replace(/^\//, '')) : null;
    const bgmPath = (customBgm && fs.existsSync(customBgm)) ? customBgm : (fs.existsSync(publicBgm) ? publicBgm : null);
    const hasBgm = Boolean(bgmPath);
    const bgmVolume = this.config.audio?.bgmVolume ?? 0.7;

    const ffmpegArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(fps),
      '-i', '-'
    ];

    if (hasBgm) {
      // Loop background music
      ffmpegArgs.push('-stream_loop', '-1', '-i', bgmPath);
    } else {
      // Generate silent stereo audio track
      ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    }

    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-b:v', bitrate,
      '-maxrate', '5000k',
      '-bufsize', '9000k',
      '-pix_fmt', 'yuv420p',
      '-g', String(fps * 2), // Keyframe every 2 seconds
      '-keyint_min', String(fps * 2)
    );

    if (hasBgm) {
      ffmpegArgs.push('-af', `volume=${bgmVolume}`);
    }

    ffmpegArgs.push(
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-f', 'flv',
      rtmpUrl
    );

    console.log('[Streamer] Spawning FFmpeg process pushing to RTMP...');
    this.ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    // Handle stdin errors to prevent write EOF / EPIPE unhandled error crash when stream stops
    this.ffmpegProcess.stdin.on('error', (err) => {
      if (err.code !== 'EOF' && err.code !== 'EPIPE') {
        console.warn('[FFmpeg stdin]', err.message);
      }
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      // Log errors, connection status, or warnings
      if (/error|fatal|fail|server|connection|opening|reject|broken/i.test(msg)) {
        console.log('[FFmpeg]', msg.trim());
      }
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log('[FFmpeg] Process closed with exit code:', code);
      this.stopStream();
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error('[FFmpeg] Failed to spawn FFmpeg:', err.message);
      this.stopStream();
    });

    // Setup Chrome DevTools Protocol Screencast
    this.client = await this.page.target().createCDPSession();
    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 85,
      maxWidth: 1080,
      maxHeight: 1920,
      everyNthFrame: 1
    });

    this.isStreaming = true;
    this.frameCount = 0;
    this.startTime = Date.now();
    this.lastFrameBuffer = null;

    // Cache latest screencast frame as it arrives
    this.client.on('Page.screencastFrame', async ({ data, sessionId }) => {
      if (!this.isStreaming) return;
      this.lastFrameBuffer = Buffer.from(data, 'base64');
      try {
        await this.client.send('Page.screencastFrameAck', { sessionId });
      } catch (e) {}
    });

    // Dedicated smooth 30 FPS ticker: pipes frames to FFmpeg at exact constant rate
    const frameIntervalMs = Math.max(16, Math.round(1000 / fps));
    this.streamTimer = setInterval(() => {
      if (!this.isStreaming || !this.ffmpegProcess || !this.ffmpegProcess.stdin || !this.ffmpegProcess.stdin.writable) {
        return;
      }
      if (this.lastFrameBuffer) {
        try {
          this.ffmpegProcess.stdin.write(this.lastFrameBuffer);
          this.frameCount++;
        } catch (e) {}
      }
    }, frameIntervalMs);

    console.log('[Streamer] RTMP Stream successfully started at 30 fps 1080x1920!');
    this.emitter.emit('stream_status', { running: true });
    return true;
  }

  async stopStream() {
    if (!this.isStreaming) return;
    this.isStreaming = false;
    console.log('[Streamer] Stopping RTMP stream...');

    if (this.streamTimer) {
      clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
    this.lastFrameBuffer = null;

    if (this.client) {
      try {
        await this.client.send('Page.stopScreencast');
      } catch (e) {}
      this.client = null;
    }

    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.stdin.end();
        this.ffmpegProcess.kill('SIGTERM');
      } catch (e) {}
      this.ffmpegProcess = null;
    }

    if (this.page) {
      try {
        await this.page.close();
      } catch (e) {}
      this.page = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
      this.browser = null;
    }

    this.emitter.emit('stream_status', { running: false });
    console.log('[Streamer] Stream stopped successfully.');
  }

  getStatus() {
    const elapsedSec = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
    const currentFps = elapsedSec > 0 ? (this.frameCount / elapsedSec).toFixed(1) : 0;
    return {
      running: this.isStreaming,
      frameCount: this.frameCount,
      uptimeSeconds: elapsedSec,
      fps: currentFps
    };
  }
}

module.exports = StreamerService;
