#!/bin/bash
# Polls the production health endpoint every 5 minutes. The moment the Neon
# block lifts (database reachable), it immediately runs:
#   1. the read-only full data backup  2. the record-count verification
# Then it exits, leaving the site to serve normally.
BASE="https://ebilikagamabeta.vercel.app"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/tmp/auto-recovery.log
echo "[$(date)] watcher started — polling $BASE/api/health/db every 300s" >> "$LOG"
while true; do
  RESP=$(curl -s --max-time 30 "$BASE/api/health/db" 2>/dev/null)
  if echo "$RESP" | grep -q '"database":"reachable"'; then
    echo "[$(date)] *** DATABASE REACHABLE — running backup + verification ***" >> "$LOG"
    cd "$ROOT"
    node scripts/backup-production-data.cjs >> "$LOG" 2>&1
    echo "[$(date)] backup finished; summary:" >> "$LOG"
    cat backups/db-backup-*/summary.json 2>/dev/null | tail -40 >> "$LOG"
    echo "[$(date)] watcher done" >> "$LOG"
    exit 0
  fi
  sleep 300
done
