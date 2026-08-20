#!/usr/bin/env bash
# The Safari bundle, driven against a throwaway daemon.
#
# The Safari build is daemon-only, so the only way to exercise it end to end is
# to put a real daemon behind it. That daemon serves the built `dist-safari/`
# bundle as its own origin, which is also what makes the page able to reach the
# API: the daemon sends no CORS headers, because its real client is an
# extension reaching it through a host permission rather than a web page.
#
# Isolation is the whole point of the setup below. This must never touch a
# daemon a developer actually runs:
#   - a dedicated port, never the product default (52222) and never another
#     suite's;
#   - a refusal to start at all if anything is already listening there;
#   - a temporary vault, removed on exit;
#   - a startup wait that gives up the moment the daemon process dies rather
#     than waiting out its timeout against someone else's daemon.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
vault=$(mktemp -d)
port=${BOOKMARKS_BUT_BETTER_E2E_SAFARI_PORT:-52227}
cargo=${CARGO:-"$HOME/.cargo/bin/cargo"}

cleanup() {
  if [[ -n "${daemon_pid:-}" ]]; then
    kill "$daemon_pid" 2>/dev/null || true
    wait "$daemon_pid" 2>/dev/null || true
  fi
  rm -rf "$vault"
}
trap cleanup EXIT

# Somebody else's process on this port would mean a real vault, so this is a
# refusal rather than a warning.
if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
  exec 3>&-
  echo "tests/e2e/run-safari.sh: something already listens on 127.0.0.1:${port}." >&2
  echo "Stop it, or set BOOKMARKS_BUT_BETTER_E2E_SAFARI_PORT to a free port." >&2
  exit 1
fi

cd "$repo_root"
bun run build:safari
"$cargo" build --workspace --locked
./target/debug/bookmarks-but-better init --vault "$vault"
./target/debug/bookmarks-but-better serve \
  --vault "$vault" \
  --ui-dir dist-safari \
  --bind 127.0.0.1 \
  --port "$port" &
daemon_pid=$!

for _ in $(seq 1 100); do
  if ! kill -0 "$daemon_pid" 2>/dev/null; then
    echo "tests/e2e/run-safari.sh: the daemon exited before it was ready." >&2
    exit 1
  fi
  if curl --fail --silent "http://127.0.0.1:${port}/api/v1/health" >/dev/null; then
    break
  fi
  sleep 0.1
done

# Health alone would also be answered by a stranger's daemon. The bundle this
# run just built is served only by the process started above, so asking for it
# proves the tests are about to drive the right one.
curl --fail --silent "http://127.0.0.1:${port}/api/v1/health" >/dev/null
curl --fail --silent "http://127.0.0.1:${port}/manifest.json" >/dev/null

BOOKMARKS_BUT_BETTER_E2E_SAFARI_BASE_URL="http://127.0.0.1:${port}" \
  bunx playwright test tests/e2e/safari.spec.ts --reporter=line
