/**
 * PM2 process manager configuration.
 *
 * Usage:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save           # persist across reboots
 *   pm2 startup        # generate the systemd/launchd startup command
 */
module.exports = {
    apps: [{
        name:         'cima',
        script:       './server.js',

        // Cluster mode: multiple workers share one port.
        // Sessions are stored in MySQL so they survive worker restarts and
        // are visible across all workers — no sticky-session Nginx config needed.
        //
        // Cap at 4 workers regardless of CPU count.  Each worker opens up to
        // 15 app DB connections + 3 session connections = 18 per worker.
        // 4 workers × 18 = 72 total — well within MySQL's 151-connection default.
        // Raise to 6 only if you also raise MySQL's max_connections.
        instances:    4,
        exec_mode:    'cluster',

        // Restart automatically if memory exceeds 500 MB
        max_memory_restart: '500M',

        // Wait 10 s before restarting after a crash (avoids rapid crash loops)
        restart_delay: 10000,

        // Give each worker time to connect to MySQL before accepting traffic
        wait_ready:   true,
        listen_timeout: 10000,

        // Keep the last 14 days of logs
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        error_file:   './logs/err.log',
        out_file:     './logs/out.log',
        merge_logs:   true,

        env: {
            NODE_ENV: 'development',
            PORT:     3000
        },
        env_production: {
            NODE_ENV: 'production',
            PORT:     3000
            // All secrets come from the .env file — do NOT put them here
        }
    }]
};
