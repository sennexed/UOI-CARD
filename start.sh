#!/bin/bash
# ==============================================================================
# Union of Indians (UOI) Discord Bot - Auto-Sync Startup Script
# Automatically pulls the latest code from GitHub (bypassing any local conflicts)
# and boots the bot cleanly.
# ==============================================================================

set -e

echo "🚀 [UOI Bot] Initializing startup sequence..."

# 1. Back up database/cards so reset doesn't destroy uncommitted local server records
if [ -d "data" ]; then
  mkdir -p /tmp/uoi_backup
  cp -r data /tmp/uoi_backup/ 2>/dev/null || true
fi

# 2. Fetch and force-reset to remote origin/main
if [ -d ".git" ]; then
  echo "📥 [Git Sync] Syncing with origin/main..."
  git fetch origin main || git fetch origin
  git reset --hard origin/main
  echo "✅ [Git Sync] Successfully synchronized working tree with origin/main."
else
  echo "ℹ️  [Git Sync] No .git directory found. Skipping git sync."
fi

# 3. Restore persisted data if needed
if [ -d "/tmp/uoi_backup/data" ]; then
  mkdir -p data
  cp -n -r /tmp/uoi_backup/data/* data/ 2>/dev/null || true
  rm -rf /tmp/uoi_backup
fi

# 4. Ensure dependencies are installed if package.json updated
if [ ! -d "node_modules" ] || [ package.json -nt node_modules ]; then
  echo "📦 [NPM] Installing/updating project dependencies..."
  npm install --omit=dev --no-audit --no-fund || npm install
fi

# 5. Start the bot server
echo "🤖 [UOI Bot] Launching Discord Bot on port ${PORT:-3000}..."
exec node index.js
