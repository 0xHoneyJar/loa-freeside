/**
 * PM2 Ecosystem Configuration
 * Production process manager configuration for Sietch Service
 */
module.exports = {
  apps: [
    {
      name: 'sietch-service',
      script: 'dist/index.js',
      cwd: '/opt/sietch-service',
      instances: 1, // SQLite doesn't support multiple writers
      exec_mode: 'fork',

      // Environment
      node_args: '--enable-source-maps',
      env_production: {
        NODE_ENV: 'production',
        // Other env vars loaded from .env file
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/sietch-service/error.log',
      out_file: '/var/log/sietch-service/out.log',
      merge_logs: true,
      log_type: 'json',

      // Process management
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 30000,

      // Auto-restart on file changes (disabled in production)
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'data', '.git'],

      // Health check
      exp_backoff_restart_delay: 100,
    },
  ],
};
