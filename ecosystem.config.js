// PM2 Process Manager Configuration for AWS EC2 Deployment
module.exports = {
  apps: [
    {
      name: 'flaggamess',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
