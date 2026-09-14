#!/bin/bash
# Production authentication verification suite (run AFTER the database is reachable).
# Usage:  BASE=https://ebilikagamabeta.vercel.app OWNER_USER=... OWNER_PASS=... bash scripts/verify-production-auth.sh
# OWNER_USER/OWNER_PASS are an existing admin account (e.g. the owner login).
# Never echoes passwords; safe to run anywhere. Exits non-zero on any failure.
set -u
BASE="${BASE:-https://ebilikagamabeta.vercel.app}"
JAR="/tmp/auth-verify-jar.txt"
rm -f "$JAR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

echo "════ 0. Database reachable? ════"
HEALTH=$(curl -s "$BASE/api/health/db")
echo "$HEALTH"
if echo "$HEALTH" | grep -q '"database":"reachable"'; then
  ok "database reachable"
else
  bad "database still unreachable — service outage ongoing; aborting (nothing to test)"
  echo; echo "RESULT: $PASS passed, $FAIL failed (aborted)"
  exit 2
fi

echo "════ 1. Homepage gate (logged out → /sign-in) ════"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[ "$C" = "307" ] && ok "homepage redirects to sign-in (307)" || bad "expected 307, got $C"

echo "════ 2. Anonymous admin API rejected ════"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/users")
[ "$C" = "403" ] || [ "$C" = "401" ] && ok "anon /api/users → $C" || bad "expected 401/403, got $C"

echo "════ 3. Admin login (valid credentials) ════"
if [ -z "${OWNER_USER:-}" ] || [ -z "${OWNER_PASS:-}" ]; then
  echo "SKIP: set OWNER_USER and OWNER_PASS to test real login"
else
  R=$(curl -s -w "\n%{http_code}" -c "$JAR" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$OWNER_USER\",\"password\":\"$OWNER_PASS\"}")
  BODY="${R%$'\n'*}"; CODE="${R##*$'\n'}"
  [ "$CODE" = "200" ] && echo "$BODY" | grep -q '"success":true' && ok "admin login 200" || bad "admin login → $CODE: $BODY"
  echo "$BODY" | grep -qE '"role":"(admin|owner)"' && ok "role=admin/owner" || bad "role missing in: $BODY"
fi

echo "════ 4. Session cookie accepted (server-side validation) ════"
R=$(curl -s -b "$JAR" "$BASE/api/auth/admin-profile")
echo "$R" | grep -q '"loggedIn":true' && ok "profile loggedIn=true" || bad "profile → $R"

echo "════ 5. Admin API works with session ════"
C=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" "$BASE/api/users")
[ "$C" = "200" ] && ok "/api/users 200 with session" || bad "expected 200, got $C"

echo "════ 6. Wrong password rejected ════"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"nobody-checks-this@ebilikagamatv.com","password":"definitely-wrong"}')
[ "$C" = "401" ] && ok "wrong password → 401" || bad "expected 401, got $C"

echo "════ 7. Normal user blocked from admin API ════"
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"nonexistent-user-xyz@ebilikagamatv.com","password":"whatever123"}')
[ "$C" = "401" ] && ok "nonexistent user → 401" || bad "expected 401, got $C"

echo "════ 8. Logout destroys session ════"
R=$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/logout")
echo "$R" | grep -q '"success":true' && ok "logout ok" || bad "logout → $R"
R=$(curl -s -b "$JAR" "$BASE/api/auth/admin-profile")
echo "$R" | grep -q '"loggedIn":false' && ok "post-logout session invalid" || bad "post-logout profile → $R"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
