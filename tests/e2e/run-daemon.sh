#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
vault=$(mktemp -d)
port=${BOOKMARKS_BUT_BETTER_E2E_PORT:-52222}
cargo=${CARGO:-"$HOME/.cargo/bin/cargo"}

cleanup() {
  if [[ -n "${daemon_pid:-}" ]]; then
    kill "$daemon_pid" 2>/dev/null || true
    wait "$daemon_pid" 2>/dev/null || true
  fi
  rm -rf "$vault"
}
trap cleanup EXIT

cd "$repo_root"
bun run build:daemon
"$cargo" build --workspace --locked
./target/debug/bookmarks-but-better init --vault "$vault"
./target/debug/bookmarks-but-better serve \
  --vault "$vault" \
  --ui-dir dist-daemon \
  --bind 127.0.0.1 \
  --port "$port" &
daemon_pid=$!

for _ in $(seq 1 100); do
  if curl --fail --silent "http://127.0.0.1:${port}/api/v1/health" >/dev/null; then
    break
  fi
  sleep 0.1
done

curl --fail --silent "http://127.0.0.1:${port}/api/v1/health" >/dev/null
BOOKMARKS_BUT_BETTER_E2E_BASE_URL="http://127.0.0.1:${port}" \
  bunx playwright test tests/e2e/daemon.spec.ts --reporter=line
