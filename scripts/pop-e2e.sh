#!/usr/bin/env bash
# Proof-of-Play + Timeline E2E against a local dev server (BASE override ok).
# Usage: BASE=http://localhost:3230 JAR=/tmp/cookies.txt bash scripts/pop-e2e.sh
set -u
BASE="${BASE:-http://localhost:3230}"
JAR="${JAR:-/tmp/cookies.txt}"
PASS=0; FAIL=0; SKIP=0

post() { # path json
  curl -s -X POST -b "$JAR" -H "Content-Type: application/json" \
    -d "$2" "$BASE$1" -o /tmp/pop-resp.json -w "%{http_code}"
}

check() { # label expected actual
  if [ "$3" = "$2" ]; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"; else FAIL=$((FAIL+1)); echo "  ✗ $1 (want $2 got $3) $(head -c 120 /tmp/pop-resp.json)"; fi
}

TS=$(date +%s)000
EV1="e2e-pop-$TS-a"
EV2="e2e-tl-$TS-b"

echo "── proof-of-play ──"
S=$(post /api/radio-playback "{\"eventId\":\"$EV1\",\"trackId\":\"1mTy9ozfz1Ftv0zmp5xfKMjIX1oNNnvPT\",\"trackTitle\":\"E2E Proof of Play Test\",\"startedAt\":$TS,\"expectedDuration\":180,\"sessionId\":\"e2e-session\"}")
check "start accepted" 200 "$S"
S=$(post /api/radio-playback "{\"eventId\":\"$EV1\",\"trackId\":\"1mTy9ozfz1Ftv0zmp5xfKMjIX1oNNnvPT\",\"trackTitle\":\"E2E Proof of Play Test\",\"startedAt\":$TS,\"sessionId\":\"e2e-session\"}")
check "duplicate start deduped" 200 "$S"
S=$(post /api/radio-playback "{\"eventId\":\"$EV1\",\"endedAt\":$TS,\"durationPlayed\":175,\"status\":\"completed\",\"interruptionReason\":\"ended\"}")
check "finalize accepted" 200 "$S"
S=$(post /api/radio-playback "{\"eventId\":\"$EV1\",\"endedAt\":$TS,\"durationPlayed\":10,\"status\":\"error\",\"interruptionReason\":\"x\"}")
check "re-finalize is no-op (deduped)" 200 "$S"

echo "── broadcast timeline ──"
S=$(post /api/radio-playback "{\"eventId\":\"$EV2\",\"kind\":\"azan_start\",\"label\":\"Azan Maghrib\",\"expectedAt\":$((TS-120000)),\"actualAt\":$((TS-118000)),\"detail\":{\"prayer\":\"maghrib\"}}")
check "timeline event accepted" 200 "$S"
S=$(post /api/radio-playback "{\"eventId\":\"$EV2\",\"kind\":\"azan_start\",\"label\":\"Azan Maghrib\",\"expectedAt\":$((TS-120000)),\"actualAt\":$((TS-117000))}")
check "timeline duplicate deduped" 200 "$S"

echo "── auth gate ──"
# proxy.ts gates non-public paths: unauthenticated browser-style requests are
# 307-redirected to /sign-in (by design), not JSON-401'd.
R=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"eventId\":\"anon-$TS\",\"kind\":\"track_start\",\"label\":\"x\",\"actualAt\":$TS}" \
  "$BASE/api/radio-playback" -o /tmp/pop-auth.json -w "%{http_code}|%{redirect_url}")
CODE="${R%%|*}"; LOC="${R#*|}"
if [ "$CODE" = "307" ] && [ "${LOC#*sign-in}" != "$LOC" ]; then
  PASS=$((PASS+1)); echo "  ✓ unauthenticated POST redirected to sign-in ($CODE)"
else
  FAIL=$((FAIL+1)); echo "  ✗ unauthenticated POST not redirected to /sign-in (got: $R)"
fi

echo "── read-back ──"
curl -s -b "$JAR" "$BASE/api/radio-playback?range=today" -o /tmp/pop-list.json
grep -q "$EV1" /tmp/pop-list.json && { PASS=$((PASS+1)); echo "  ✓ history contains test record"; } || { FAIL=$((FAIL+1)); echo "  ✗ history missing test record"; }
curl -s -b "$JAR" "$BASE/api/radio-timeline?range=today" -o /tmp/pop-tl.json
grep -q "$EV2" /tmp/pop-tl.json && { PASS=$((PASS+1)); echo "  ✓ timeline contains test event"; } || { FAIL=$((FAIL+1)); echo "  ✗ timeline missing test event"; }

echo "── incidents ──"
curl -s -b "$JAR" "$BASE/api/incidents" -o /tmp/inc-list.json
INCID=$(grep -o '"id":"[^"]*"' /tmp/inc-list.json | head -1 | cut -d'"' -f4)
if [ -n "$INCID" ]; then
  S=$(curl -s -X PATCH -b "$JAR" -H "Content-Type: application/json" -d "{\"id\":\"$INCID\",\"status\":\"investigating\"}" "$BASE/api/incidents" -o /tmp/inc-resp.json -w "%{http_code}")
  check "incident → investigating" 200 "$S"
  S=$(curl -s -X PATCH -b "$JAR" -H "Content-Type: application/json" -d "{\"id\":\"$INCID\",\"status\":\"resolved\"}" "$BASE/api/incidents" -o /tmp/inc-resp.json -w "%{http_code}")
  check "incident → resolved" 200 "$S"
  curl -s -b "$JAR" "$BASE/api/incidents?status=resolved" -o /tmp/inc-resolved.json
  grep -q "$INCID" /tmp/inc-resolved.json && { PASS=$((PASS+1)); echo "  ✓ resolved incident listed under status=resolved"; } || { FAIL=$((FAIL+1)); echo "  ✗ resolved incident missing from filtered list"; }
else
  SKIP=$((SKIP+1)); echo "  - no incidents present, PATCH flow skipped"
fi

echo "── notifications ──"
N=$(curl -s -X POST -b "$JAR" -H "Content-Type: application/json" \
  -d '{"title":"E2E Notification Test","message":"Automated flow test (deactivated by script).","targetAll":true}' \
  "$BASE/api/notifications" -o /tmp/notif-create.json -w "%{http_code}")
check "create announcement (201)" 201 "$N"
NID=$(grep -o '"id":"[^"]*"' /tmp/notif-create.json | head -1 | cut -d'"' -f4)
if [ -n "$NID" ]; then
  curl -s -b "$JAR" "$BASE/api/notifications?scope=mine" -o /tmp/notif-mine.json
  grep -q "$NID" /tmp/notif-mine.json && { PASS=$((PASS+1)); echo "  ✓ announcement visible in scope=mine"; } || { FAIL=$((FAIL+1)); echo "  ✗ announcement missing from scope=mine"; }
  S=$(curl -s -X PATCH -b "$JAR" -H "Content-Type: application/json" -d "{\"action\":\"mark-read\",\"id\":\"$NID\"}" "$BASE/api/notifications" -o /tmp/notif-read.json -w "%{http_code}")
  check "mark-read accepted" 200 "$S"
  curl -s -b "$JAR" "$BASE/api/notifications?scope=mine" -o /tmp/notif-mine2.json
  grep -o "\"id\":\"$NID\"[^}]*" /tmp/notif-mine2.json | head -1 | grep -q '"readAt":"2' \
    && { PASS=$((PASS+1)); echo "  ✓ read state persisted"; } || { FAIL=$((FAIL+1)); echo "  ✗ read state not persisted"; }
  S=$(curl -s -X PATCH -b "$JAR" -H "Content-Type: application/json" -d "{\"action\":\"deactivate\",\"id\":\"$NID\"}" "$BASE/api/notifications" -o /tmp/notif-deact.json -w "%{http_code}")
  check "deactivate (admin) accepted" 200 "$S"
  curl -s -b "$JAR" "$BASE/api/notifications?scope=mine" -o /tmp/notif-mine3.json
  grep -q "$NID" /tmp/notif-mine3.json && { FAIL=$((FAIL+1)); echo "  ✗ deactivated announcement still visible to users"; } || { PASS=$((PASS+1)); echo "  ✓ deactivated announcement hidden from users"; }
else
  SKIP=$((SKIP+1)); echo "  - announcement create failed, notification flow skipped"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" = "0" ]
