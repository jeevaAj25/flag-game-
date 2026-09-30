# 🚀 AWS Deployment Guide - Live Flag Count Fight

This guide explains how to deploy and run the **Live Flag Count Fight** application on Amazon Web Services (AWS) in production.

---

## 📌 Deployment Options Overview

| Method | Recommended Use Case | Recommended Instance / Specs | Cost Estimate |
| :--- | :--- | :--- | :--- |
| **Option 1: AWS EC2 + PM2 (Recommended)** | Direct RTMP Live Streaming (Headless Chrome + FFmpeg) or 24/7 stream hosting with full control | `t3.medium` (2 vCPU, 4GB RAM) for streaming, or `t3.small` / `t3.micro` for overlay server only | ~$10 - $30 / month |
| **Option 2: AWS App Runner / ECS (Docker)** | Containerized deployment using the provided `Dockerfile` | 1 vCPU, 2GB - 4GB Memory | Pay-per-use |

---

## 🛠️ Option 1: AWS EC2 Deployment (Step-by-Step)

### Step 1: Launch an EC2 Instance
1. Go to the [AWS EC2 Console](https://console.aws.amazon.com/ec2/).
2. Click **Launch instance**.
3. Choose **Ubuntu Server 24.04 LTS** (or 22.04 LTS), 64-bit (x86_64).
4. Instance Type:
   - For **Direct RTMP Streaming** (headless Chrome + FFmpeg encoding): Select **`t3.medium`** or **`c6i.large`** (recommended for smooth 30 fps video encoding).
   - For **Overlay Server Only** (broadcasting via OBS on your local PC): Select **`t3.small`** or **`t3.micro`**.
5. Key pair: Select or create your `.pem` key pair for SSH access.
6. **Network / Security Group**:
   - Check **Allow SSH traffic from anywhere** (or My IP) (Port 22).
   - Check **Allow HTTP traffic from the internet** (Port 80).
   - Check **Allow HTTPS traffic from the internet** (Port 443).
   - Add Custom TCP Rule: Port `3000` (if accessing directly without Nginx).
7. Storage: Set Root Volume to at least **20 GiB gp3**.
8. Click **Launch instance**.

---

### Step 2: Connect and Install Dependencies
Connect to your EC2 instance via SSH:
```bash
ssh -i /path/to/your-key.pem ubuntu@<YOUR_EC2_PUBLIC_IP>
```

Update system packages and install Node.js (v20 LTS), FFmpeg, Chromium, and build tools:
```bash
# Update package lists
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js, Git, FFmpeg, Chromium, and build essentials
sudo apt install -y nodejs git ffmpeg chromium-browser \
    fonts-liberation fonts-noto-color-emoji fonts-freefont-ttf \
    build-essential python3 curl

# Install PM2 process manager globally
sudo npm install -g pm2
```

Verify installations:
```bash
node -v      # Should output v20.x.x
npm -v       # Should output 10.x.x
ffmpeg -version
chromium-browser --version
```

---

### Step 3: Clone Project & Configure
Clone your repository or upload your project files:
```bash
git clone <YOUR_GIT_REPOSITORY_URL> /home/ubuntu/flaggamess
cd /home/ubuntu/flaggamess

# Install production dependencies
npm install --omit=dev
```

Create your production environment file from the template:
```bash
cp .env.example .env
nano .env
```
Fill in your credentials in `.env`:
```env
PORT=3000
NODE_ENV=production
STREAM_KEY=your_youtube_stream_key
YOUTUBE_VIDEO_ID=your_video_id
YOUTUBE_API_KEY=your_youtube_data_api_v3_key
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
FFMPEG_PATH=/usr/bin/ffmpeg
```
Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

### Step 4: Start with PM2 Process Manager
PM2 ensures the app automatically restarts if it crashes, and boots on server reboot:

```bash
# Start the application using ecosystem.config.js
pm2 start ecosystem.config.js

# Save running processes to PM2 registry
pm2 save

# Setup PM2 to launch on server boot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Check status and logs:
```bash
pm2 status
pm2 logs flaggamess
```

You can now visit:
- **Admin Panel**: `http://<YOUR_EC2_PUBLIC_IP>:3000/admin`
- **Overlay**: `http://<YOUR_EC2_PUBLIC_IP>:3000/overlay`
- **Health Check**: `http://<YOUR_EC2_PUBLIC_IP>:3000/health`

---

### Step 5: (Optional) Setup Nginx & Free SSL (Let's Encrypt)
To access your app via standard domain with HTTPS (`https://yourdomain.com`):

1. Install Nginx & Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

2. Create an Nginx site config:
```bash
sudo nano /etc/nginx/sites-available/flaggamess
```
Paste the following (replace `yourdomain.com` with your domain):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/flaggamess /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

4. Obtain free SSL certificate:
```bash
sudo certbot --nginx -d yourdomain.com
```

---

## 🐳 Option 2: Docker / AWS ECS / App Runner

The project includes an optimized `Dockerfile` equipped with Chromium, FFmpeg, fonts, and health check support.

### Local Docker Build & Test:
```bash
# Build Docker image
docker build -t flaggamess .

# Run container
docker run -d \
  -p 3000:3000 \
  --name flaggamess-live \
  --env-file .env \
  flaggamess
```

### AWS ECR & ECS (Elastic Container Service):
1. Authenticate Docker with Amazon ECR:
   ```bash
   aws ecr get-login-password --region <YOUR_AWS_REGION> | docker login --username AWS --password-stdin <YOUR_ACCOUNT_ID>.dkr.ecr.<YOUR_AWS_REGION>.amazonaws.com
   ```
2. Create repository and push image:
   ```bash
   aws ecr create-repository --repository-name flaggamess
   docker tag flaggamess:latest <YOUR_ACCOUNT_ID>.dkr.ecr.<YOUR_AWS_REGION>.amazonaws.com/flaggamess:latest
   docker push <YOUR_ACCOUNT_ID>.dkr.ecr.<YOUR_AWS_REGION>.amazonaws.com/flaggamess:latest
   ```
3. In **AWS ECS**, create a Task Definition specifying:
   - Port mappings: `3000` (TCP)
   - Health check command: `curl -f http://localhost:3000/health || exit 1`
   - Memory: at least 2048 MB (for streaming mode)

---

## 🛡️ Production & Security Best Practices on AWS

1. **Protect Secrets**:
   - Never commit `.env` or sensitive stream keys to Git.
   - Use AWS Systems Manager Parameter Store or AWS Secrets Manager if running on ECS/EC2.
2. **Persistence**:
   - Database is stored at `data/game.db`. If using Docker/ECS, mount an Amazon EBS volume or persistent volume at `/app/data` so scores persist across container updates.
3. **Firewall / Security Groups**:
   - Restrict port 22 (SSH) to your trusted IP.
   - Restrict the Admin panel (`/admin`) via Nginx Basic Auth if publicly exposed.
