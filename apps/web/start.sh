#!/bin/bash
cd /home/tecnodespegue/FTTH-Copilot-workdir/FTTH-Copilot/apps/web
# Give the previous Next.js instance time to release port 3001 on PM2 restart.
# Without this, every restart hits EADDRINUSE because PM2 starts the new
# process before the old one has finished shutting down.
sleep 2
exec npx next start -p 3001 -H 0.0.0.0
