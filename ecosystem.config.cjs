module.exports = {
  apps: [
    {
      name: 'ftth-copilot',
      script: '/bin/bash',
      args: '/home/tecnodespegue/FTTH-Copilot-workdir/FTTH-Copilot/apps/web/start.sh',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'cloudflared',
      script: '/home/tecnodespegue/bin/cloudflared',
      args: 'tunnel --protocol http2 --no-autoupdate run --token eyJhIjoiMmQ4YWQ3YTFiYzk0ODAyOGU3YjhlMmQxYWJhZGYzYjEiLCJ0IjoiYmZiODIzYTktNTI0Mi00Y2M4LTgzNjgtY2I2Y2ZiYWY1YjUwIiwicyI6Ik9UaGlOemRoWkdNdE1qYzFPUzAwWmpObExUZ3dZekF0TWpGbVlUZGlaRGs1TjJZMyJ9',
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
};
