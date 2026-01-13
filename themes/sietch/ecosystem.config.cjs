/**
 * PM2 Ecosystem Configuration for Sietch Service
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart sietch
 *   pm2 stop sietch
 *   pm2 logs sietch
 *
 * Save PM2 process list:
 *   pm2 save
 *
 * Setup startup script:
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'sietch',
      script: './dist/index.js',
      cwd: '/opt/sietch/current/sietch-service',

      // Environment
      node_args: '--enable-source-maps',
      env: {
        NODE_ENV: 'production',
      },

      // Load environment from file
      // Note: PM2 reads .env from cwd, but we use explicit path
      // Environment variables should be in /opt/sietch/.env
      env_file: '/opt/sietch/.env',

      // Process management
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',

      // Restart behavior
      restart_delay: 1000,
      min_uptime: '10s',
      max_restarts: 10,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Logging
      error_file: '/opt/sietch/logs/error.log',
      out_file: '/opt/sietch/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Resource limits
      // max_memory_restart: '256M', // Already set above

      // Health check (optional - requires pm2-plus)
      // health_check_http: 'http://127.0.0.1:3000/health',
      // health_check_http_interval: 30000,
    },
  ],
};
