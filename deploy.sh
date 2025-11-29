#!/bin/bash

echo "🎄 Deploying Christmas Party updates..."

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull

# Install any new dependencies
echo "📦 Installing dependencies..."
npm install --production

# Restart the server
echo "🔄 Restarting server..."
pm2 restart xmasparty

echo "✅ Deploy complete!"
pm2 status
