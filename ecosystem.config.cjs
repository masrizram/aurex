# AEE PM2 Ecosystem — auto-restart on crash
# Usage: pm2 start ecosystem.config.cjs --env production
# Process crash → auto-restart. Logs to ./logs/

module.exports = {
  apps: [
    {
      name: "aee-api",
      script: "scripts/serve.ts",
      interpreter: "npx",
      interpreter_args: "tsx",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        AEE_DEV_MODE: "",
      },
      env_staging: {
        NODE_ENV: "staging",
        AEE_DEV_MODE: "",
      },
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Memory threshold restart
      max_memory_restart: "512M",
      // Logging
      error_file: "./logs/aee-api-error.log",
      out_file: "./logs/aee-api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
  ],
};
