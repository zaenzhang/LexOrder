#!/usr/bin/env bash
# Serve the existing disposable acceptance workspace through the unified Personal runtime.
set -euo pipefail
cd "$(dirname "$(realpath "$0")")/../.."
session=lexorder-chronicle
runtime=tools/workbench-m1/.runtime
export M1_WORKSPACE="$runtime/chronicle-qa"
export M1_READY_FILE="$runtime/chronicle-qa-ready.json"
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-personal-chronicle-qa}"
export M1_PORT="${M1_PORT:-0}"
export BUN_BIN="${BUN_BIN:-bun}"
export M1_WORKBENCH_WEB=1
unset M1_CHRONICLE_ORIGIN

owned_fixture() {
  node --input-type=module --eval '
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    const { mode } = JSON.parse(readFileSync(process.env.M1_WORKSPACE + "/workspace.json"));
    const cases = JSON.parse(readFileSync(process.env.M1_WORKSPACE + "/chronicle-smoke-cases.json"));
    assert(mode === "PERSONAL" && cases.length === 2 && cases.every(row => row.internalCode.startsWith("CHRONICLE-TEST-")));
  '
}
runtime_origin() {
  node --input-type=module --eval '
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { fixture } from "./tools/workbench-m1/chronicle-smoke/fixture.mjs";
    const { origin } = JSON.parse(readFileSync(process.env.M1_READY_FILE, "utf8"));
    const { cases, request } = await fixture();
    const endpoint = "/api/personal/matter-workspace?section=identity&matter=" + cases[0].id;
    assert.equal((await request(endpoint).then(response => response.json())).id, cases[0].id);
    console.log(origin);
  '
}
build() {
  "$BUN_BIN" --no-env-file --no-install tools/workbench-m1/build-personal.mjs --desktop
}
case "${1:-status}" in
  start)
    owned_fixture
    if runtime_origin 2>/dev/null; then exit 0; fi
    if ! tmux has-session -t "=$session" 2>/dev/null; then
      test -s "$NEXT_DIST_DIR/standalone/public/_chronicle/index.html" || build >&2
      tmux new-session -d -s "$session" -n runtime -e "NEXT_DIST_DIR=$NEXT_DIST_DIR" -e "M1_PORT=$M1_PORT" -e "BUN_BIN=$BUN_BIN" bash "$(realpath "$0")" run-runtime
    fi
    for attempt in $(seq 1 30); do
      if test -s "$M1_READY_FILE" && runtime_origin 2>/dev/null; then exit 0; fi
      sleep 1
    done
    echo "Chronicle unified runtime did not start. Check $runtime/chronicle-harness-runtime.log." >&2
    exit 1
    ;;
  status)
    tmux list-panes -s -t "=$session" -F '#{window_name} dead=#{pane_dead}'
    runtime_origin
    ;;
  dev)
    LEXORDER_DEV_RUNTIME_ORIGIN=$(bash "$(realpath "$0")" start)
    export LEXORDER_DEV_RUNTIME_ORIGIN
    cd desktop/personal-chronicle
    exec pnpm run dev
    ;;
  stop)
    for pane in $(tmux list-panes -s -t "=$session" -F '#{pane_id} #{pane_dead}' | awk '$2 == 0 {print $1}'); do
      tmux send-keys -t "$pane" C-c
    done
    for attempt in $(seq 1 100); do
      if ! tmux list-panes -s -t "=$session" -F '#{pane_dead}' 2>/dev/null | rg -q '^0$' && ! test -e "$M1_READY_FILE"; then
        if tmux has-session -t "=$session" 2>/dev/null; then tmux kill-session -t "=$session"; fi
        exit 0
      fi
      sleep .3
    done
    echo 'Chronicle has not finished stopping.' >&2
    exit 1
    ;;
  build) build ;;
  run-runtime)
    owned_fixture
    exec "$BUN_BIN" --no-env-file --no-install tools/workbench-m1/personal-runtime.mjs >> "$runtime/chronicle-harness-runtime.log" 2>&1
    ;;
  *)
    echo "Usage: $0 {start|dev|status|stop|build}" >&2
    exit 2
    ;;
esac
