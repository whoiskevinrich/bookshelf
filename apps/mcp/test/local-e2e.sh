#!/usr/bin/env bash
# Manual local end-to-end harness for the Bookshelf MCP server.
#
# This complements the vitest suite (unit + protocol with mocked auth) by hitting
# the *running* server over real HTTP with a real Cognito token and the real API.
#
# Phase 1 (transport/auth) needs no token and always runs.
# Phase 2 (tools) runs only when MCP_TOKEN is set (a Cognito *ID* token whose
#   audience is the bookshelf-mcp client — mint one via docs/runbooks/mcp-local-claude.md).
# Phase 2 mutation (add/update/notes/remove) runs only when MCP_MUTATE=1, and uses
#   TEST_ISBN. It pre-cleans and post-cleans that ISBN, so DON'T point TEST_ISBN at a
#   book you actually own — the pre-clean would delete your real entry.
#
# Usage:
#   bash apps/mcp/test/local-e2e.sh
#   MCP_TOKEN=<id_token> bash apps/mcp/test/local-e2e.sh
#   MCP_TOKEN=<id_token> MCP_MUTATE=1 TEST_ISBN=9780262033848 bash apps/mcp/test/local-e2e.sh
set -uo pipefail

BASE="${MCP_BASE:-http://localhost:3002}"
MCP="$BASE/mcp"
ACCEPT="application/json, text/event-stream"
TOKEN="${MCP_TOKEN:-}"
TEST_ISBN="${TEST_ISBN:-9780262033848}" # Intro to Algorithms (CLRS) — used only when MCP_MUTATE=1
BODY=$(mktemp)
pass=0; fail=0; skip=0

trap 'rm -f "$BODY"' EXIT

hdr() { printf '\n=== %s ===\n' "$1"; }
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
no()   { echo "  FAIL  $1 ${2:+— $2}"; fail=$((fail+1)); }
sk()   { echo "  SKIP  $1"; skip=$((skip+1)); }

# status METHOD URL [curl args...] -> prints HTTP code, writes body to $BODY
status() { local m="$1" url="$2"; shift 2; curl -s -o "$BODY" -w '%{http_code}' -X "$m" "$url" "$@"; }
body()   { cat "$BODY"; }
has()    { grep -q -- "$2" "$BODY" && ok "$1" || no "$1" "missing: $2"; }

# rpc METHOD-NAME JSON  -> POSTs a JSON-RPC envelope with auth+correct headers
rpc() {
  status POST "$MCP" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: $ACCEPT" \
    -d "$2"
}
tool_call() { # tool_call NAME ARGS_JSON
  rpc call "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" >/dev/null
}

############################################################
hdr "Phase 1 — transport & auth (no token)"
############################################################

c=$(status GET "$BASE/health");                    [ "$c" = 200 ] && has "GET /health 200" '"status":"ok"' || no "GET /health" "code $c"
c=$(status GET "$BASE/.well-known/oauth-protected-resource");   [ "$c" = 200 ] && has "protected-resource discovery 200" 'authorization_servers' || no "protected-resource discovery" "code $c"
c=$(status GET "$BASE/.well-known/oauth-authorization-server"); [ "$c" = 200 ] && has "auth-server discovery 200" '/oauth2/authorize' || no "auth-server discovery" "code $c"

c=$(status GET "$MCP");    [ "$c" = 405 ] && has "GET /mcp 405" '-32000' || no "GET /mcp" "code $c (want 405)"
c=$(status DELETE "$MCP"); [ "$c" = 405 ] && ok "DELETE /mcp 405" || no "DELETE /mcp" "code $c (want 405)"
c=$(status GET "$BASE/nope"); [ "$c" = 404 ] && ok "unknown path 404" || no "unknown path" "code $c (want 404)"

# 401 paths
c=$(status POST "$MCP" -H "Content-Type: application/json" -H "Accept: $ACCEPT" -d '{}')
[ "$c" = 401 ] && ok "POST /mcp no auth 401" || no "POST /mcp no auth" "code $c"
# WWW-Authenticate header advertises the resource metadata
curl -s -D - -o /dev/null -X POST "$MCP" -H "Accept: $ACCEPT" -d '{}' | grep -iq 'www-authenticate:.*oauth-protected-resource' \
  && ok "401 advertises WWW-Authenticate resource metadata" || no "WWW-Authenticate header"
c=$(status POST "$MCP" -H "Authorization: Basic abc" -H "Accept: $ACCEPT" -d '{}')
[ "$c" = 401 ] && ok "POST /mcp Basic scheme 401" || no "POST /mcp Basic" "code $c"
c=$(status POST "$MCP" -H "Authorization: Bearer not.a.real.token" -H "Content-Type: application/json" -H "Accept: $ACCEPT" -d '{}')
[ "$c" = 401 ] && has "POST /mcp garbage token 401" 'Invalid or expired token' || no "POST /mcp garbage token" "code $c"

############################################################
hdr "Phase 2 — tool execution (needs MCP_TOKEN)"
############################################################
if [ -z "$TOKEN" ]; then
  sk "Phase 2 — set MCP_TOKEN to run (see docs/runbooks/mcp-local-claude.md)"
else
  # Transport-level checks that require a valid token (these run inside the SDK transport)
  c=$(status POST "$MCP" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
  [ "$c" = 406 ] && ok "missing text/event-stream 406" || no "Accept 406" "code $c (token valid? aud=mcp?)"
  c=$(status POST "$MCP" -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" -H "Accept: $ACCEPT" \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
  [ "$c" = 415 ] && ok "wrong Content-Type 415" || no "Content-Type 415" "code $c"
  c=$(rpc x '{ not json'); [ "$c" = 400 ] && ok "malformed JSON body 400" || no "malformed JSON 400" "code $c"

  # initialize + discovery
  rpc init '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"local-e2e","version":"1.0"}}}' >/dev/null
  has "initialize → server name 'bookshelf'" '"name":"bookshelf"'
  rpc list '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' >/dev/null
  for t in list_shelf add_book update_book_status remove_book set_notes search_books lookup_book_isbn lookup_book_asin; do
    has "tools/list includes $t" "\"$t\""
  done

  # read-only tools (no shelf mutation)
  tool_call search_books '{"query":"Dune Frank Herbert"}'; has "search_books returns results" 'title'
  tool_call lookup_book_isbn '{"isbn":"9780441013593"}'; has "lookup_book_isbn(Dune) returns title" 'title'

  # input validation (should error before hitting the API)
  tool_call add_book '{"isbn":"9780441013593","status":"borrowed"}'; has "invalid status enum → error" 'isError\|error'
  tool_call list_shelf '{"limit":500}'; has "limit>100 → schema error" 'isError\|error'

  if [ "${MCP_MUTATE:-0}" = 1 ]; then
    hdr "Phase 2b — shelf mutation (TEST_ISBN=$TEST_ISBN)"
    # SAFETY: never touch an ISBN already on the shelf — the lifecycle ends in a
    # remove_book, so operating on a real entry would delete it. Bail loudly instead.
    tool_call list_shelf '{"limit":100}'
    if grep -q -- "$TEST_ISBN" "$BODY"; then
      no "TEST_ISBN $TEST_ISBN already on your shelf — set TEST_ISBN to a book you don't own"
    else
      tool_call add_book "{\"isbn\":\"$TEST_ISBN\",\"status\":\"want\"}"; has "add_book(want) succeeds" 'isbn\|status\|added\|"'
      tool_call add_book "{\"isbn\":\"$TEST_ISBN\",\"status\":\"want\"}"; has "duplicate add → friendly 409 msg" 'already on your shelf'
      tool_call list_shelf '{"status":"want","limit":100}';      has "list_shelf(want) includes TEST_ISBN" "$TEST_ISBN"
      tool_call update_book_status "{\"isbn\":\"$TEST_ISBN\",\"status\":\"owned\"}"; has "update_book_status→owned" 'owned'
      tool_call set_notes "{\"isbn\":\"$TEST_ISBN\",\"notes\":\"e2e test note\"}"; has "set_notes sets a note" 'e2e test note\|notes'
      tool_call set_notes "{\"isbn\":\"$TEST_ISBN\",\"notes\":null}";              has "set_notes(null) clears" 'notes\|null\|"'
      tool_call remove_book "{\"isbn\":\"$TEST_ISBN\"}";         has "remove_book confirms removal" 'removed'
      tool_call list_shelf '{"limit":100}';                      grep -q -- "$TEST_ISBN" "$BODY" && no "shelf no longer lists TEST_ISBN" "still present" || ok "shelf no longer lists TEST_ISBN"
    fi
  else
    sk "Phase 2b mutation — set MCP_MUTATE=1 (mutates your real dev shelf; auto-cleaned)"
  fi
fi

############################################################
printf '\n=== Summary: %d passed, %d failed, %d skipped ===\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
