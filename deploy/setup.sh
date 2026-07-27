#!/usr/bin/env bash
#
# DIP Engine — droplet provisioning (Ubuntu 22.04/24.04). Idempotent: safe to
# re-run. Installs Node 22 + pnpm, installs deps, builds, and applies DB
# migrations. Does NOT start anything — see DEPLOY.md for the API service +
# ingest cron.
#
#   sudo bash deploy/setup.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dip-engine}"
NODE_MAJOR=22

echo "==> DIP Engine setup (APP_DIR=$APP_DIR)"

# --- Node.js 22 (NodeSource) ---
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  echo "==> Installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "==> Node $(node -v) already present"
fi

# --- pnpm via corepack ---
echo "==> Enabling pnpm via corepack"
corepack enable
corepack prepare pnpm@9 --activate

# --- app directory must contain the repo ---
if [ ! -f "$APP_DIR/package.json" ]; then
  echo "!! $APP_DIR does not contain the DIP Engine repo."
  echo "   Clone it first, e.g.:  git clone <repo-url> $APP_DIR"
  exit 1
fi
cd "$APP_DIR"

# --- .env must exist (copied from deploy/.env.production.example) ---
if [ ! -f "$APP_DIR/.env" ]; then
  echo "!! $APP_DIR/.env missing."
  echo "   cp deploy/.env.production.example .env  &&  edit DATABASE_URL"
  exit 1
fi

# --- install (incl. dev deps: tsx runs the ingest CLI), build, migrate ---
echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Building workspace"
pnpm build

echo "==> Applying database migrations"
pnpm db:migrate

echo "==> Seeding the approved source (idempotent)"
pnpm db:seed

echo "==> Setup complete."
echo "    Next: install the API service and ingest cron (see deploy/DEPLOY.md)."
