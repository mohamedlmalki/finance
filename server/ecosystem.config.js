// --- FILE: server/ecosystem.config.js ---
module.exports = {
  apps: [
    {
      name: 'zoho-web-api',
      script: 'index.js',
      instances: 1, // Only 1 Web Server needed for Dashboard and WebSockets
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3009
      }
    },
    {
      name: 'zoho-heavy-worker',
      script: 'worker-app.js',
      instances: 2, // Spin up 2 completely separate Heavy Worker processes! 
      autorestart: true,
      watch: false,
      max_memory_restart: '2G', // Give the workers lots of room to breathe
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};