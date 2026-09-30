# Production Dockerfile for Flag Count Fight (AWS ECS / App Runner / EC2)
FROM node:20-bookworm-slim

# Install system dependencies:
# - build essentials for better-sqlite3 compilation
# - ffmpeg for RTMP streaming pipe
# - chromium for headless overlay screencast
# - fonts for crisp scoreboard rendering and emojis
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer and environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    FFMPEG_PATH=/usr/bin/ffmpeg

# Working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application files
COPY config.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY data/.gitkeep ./data/.gitkeep

# Expose server port
EXPOSE 3000

# AWS container health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"]
