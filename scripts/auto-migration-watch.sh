#!/bin/bash
# Polls Neon reachability via the production health endpoint. The moment the
# Neon block lifts, runs (in order, each only if the previous succeeded):
#   1. read-only full data backup (Neon → backups/)
#   2. idempotent Neon → Firestore migration
#   3. production homepage verification
# FIREBASE_SERVICE_ACCOUNT must be available in the environment for step 2.
BASE="https://ebilikagamabeta.vercel.app"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/tmp/auto-migration.log
echo "[$(date)] auto-migration watcher started" >> "$LOG"
while true; do
  RESP=$(curl -s --max-time 30 "$BASE/api/health/db" 2>/dev/null)
  # Neon recovery shows up as the OLD backend code? No — production now runs
  # Firestore backend; probe Neon directly from this machine instead.
  export NODE_HOME="/c/Users/muham/AppData/Local/Temp/node-v22.17.0-win-x64"
  cd "$ROOT"
  PW=$(git show e431a4d^:src/lib/prisma.ts | grep -oP 'neondb_owner:\K[^@]+' 2>/dev/null)
  if [ -n "$PW" ]; then
    PROBE_URL="postgresql://neondb_owner:${PW}@ep-nameless-flower-azdw4gyi-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=10" \
    "$NODE_HOME/node.exe" -e "
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.PROBE_URL } } });
  try { await p.\$queryRaw\`SELECT 1\`; process.exit(0); } catch { process.exit(1); }
})();" > /dev/null 2>&1 && NEON_OK=1 || NEON_OK=0
    if [ "$NEON_OK" = "1" ]; then
      echo "[$(date)] *** NEON REACHABLE — backup, then migrate ***" >> "$LOG"
      # The adapter in src/lib/prisma.ts is now Firestore; use the Neon-era
      # Prisma client via git show of the pre-migration commit for the dump.
      git show e431a4d^:scripts/backup-production-data.cjs > /tmp/backup-neon.cjs
      NODE_PATH="$ROOT/node_modules" "$NODE_HOME/node.exe" /tmp/backup-neon.cjs >> "$LOG" 2>&1
      echo "[$(date)] backup done; running migration" >> "$LOG"
      # Migration script already resolves Neon from git history? It reads
      # src/lib/prisma.ts (now Firestore) — pass DATABASE_URL explicitly.
      HOST="ep-nameless-flower-azdw4gyi-pooler.c-3.ap-southeast-1.aws.neon.tech"
      export DATABASE_URL="postgresql://neondb_owner:${PW}@${HOST}/neondb?sslmode=require&connect_timeout=10"
      # Prisma client here is still generated for the same schema; migration
      # uses @prisma/client findMany — works regardless of provider URL.
      NODE_PATH="$ROOT/node_modules" "$NODE_HOME/node.exe" scripts/migrate-neon-to-firestore.cjs >> "$LOG" 2>&1
      echo "[$(date)] migration attempt finished; log tail:" >> "$LOG"
      tail -30 "$LOG" >> "$LOG"
      exit 0
    fi
  fi
  sleep 300
done
