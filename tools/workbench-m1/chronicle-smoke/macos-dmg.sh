#!/usr/bin/env bash
set -euo pipefail

package_dir=${1:?Supply the directory containing the Apple Silicon DMG}
workspace=${2:?Supply a new absolute synthetic workspace}
mode=${3:-}
shopt -s nullglob
bundles=("$package_dir"/*.dmg)
test "${#bundles[@]}" -eq 1
hdiutil verify "${bundles[0]}"
mount="$workspace-dmg"
mkdir "$mount"
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "${bundles[0]}"
trap 'hdiutil detach "$mount"' EXIT
apps=("$mount"/*.app)
test "${#apps[@]}" -eq 1

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
run_window() {
  local target=$1
  local round=${2:-}
  if [[ -n "$round" ]]; then
    export LEXORDER_SMOKE_PERFORMANCE_CASEBOOK="$target-casebooks"
    mkdir -m 700 "$LEXORDER_SMOKE_PERFORMANCE_CASEBOOK"
  fi
  LEXORDER_SMOKE_RUNTIME_ROOT="${apps[0]}/Contents/Resources/lexorder-runtime" \
  LEXORDER_SMOKE_BUN="${apps[0]}/Contents/MacOS/lexorder-bun" \
    bun --no-env-file --no-install "$script_dir/sidecar.mjs" "$target"
  node "$script_dir/macos-installed.mjs" "${apps[0]}" "$target" "$mode" "$round"
}

if [[ "$mode" == "--case-flow" || "$mode" == "--batch" ]]; then
  for round in 1 2 3; do
    run_window "$workspace-$round" "$round"
  done
else
  run_window "$workspace"
fi
