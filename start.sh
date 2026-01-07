#!/bin/bash

# StandX Maker Bot - Start Script
# This script starts the bot using PM2 process manager

set -e

# Change to the script's directory
cd "$(dirname "$0")"

echo "🚀 Starting StandX Maker Bot..."
echo "Working directory: $(pwd)"

# Start the bot using PM2 ecosystem config
pm2 start ecosystem.config.js

# Wait a moment for the bot to start
sleep 2

# Show status
pm2 status

echo ""
echo "✅ Bot started successfully!"
echo ""
echo "Useful commands:"
echo "  View logs:     pm2 logs standx-maker-bot"
echo "  Monitor:       pm2 monit"
echo "  Stop bot:      ./stop.sh"
echo "  Restart:       pm2 restart standx-maker-bot"
