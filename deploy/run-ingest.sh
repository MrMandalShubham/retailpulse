#!/usr/bin/env bash
#
# DIP Engine — scheduled catalog sync (called by cron). Refreshes the map, then
# drains a batch of pending products into the clean store + snapshots. Idempotent
# and safe to overlap-guard with flock (see deploy/crontab.example).
#
#   APP_DIR=/opt/dip-engine INGEST_BATCH=500 bash deploy/run-ingest.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dip-engine}"
SLUG="${SOURCE_SLUG:-oliveyoung-global}"
BATCH="${INGEST_BATCH:-500}"
LOG_DIR="${LOG_DIR:-$APP_DIR/logs}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
echo "[$(ts)] sync start (slug=$SLUG batch=$BATCH)" >>"$LOG_DIR/sync.log"

# 1) Refresh the catalog map — newly-listed products land as `pending`.
pnpm discover:run >>"$LOG_DIR/sync.log" 2>&1 || echo "[$(ts)] discover failed (continuing)" >>"$LOG_DIR/sync.log"

# 2) Drain a batch of pending products (fetch API in memory → clean row + snapshot).
pnpm ingest:api "$SLUG" "$BATCH" >>"$LOG_DIR/sync.log" 2>&1

echo "[$(ts)] sync done" >>"$LOG_DIR/sync.log"

# --- Full refresh of ALREADY-ingested products (fresh prices / new snapshots) ---
# `ingest:api` only processes rows with batch_status='pending', so this drain
# does NOT re-fetch products already marked 'ingested'. To take a fresh daily
# snapshot of the WHOLE catalog, re-queue ingested rows first, e.g.:
#
#   psql "$DATABASE_URL" -c \
#     "update discovered_product_pages set batch_status='pending' where batch_status='ingested';"
#
# then let the next run(s) drain them. Snapshots are idempotent per day, so a
# same-day re-fetch just refreshes that day's row. Wire this up once the desired
# cadence is decided (the schedule was intentionally left open).
