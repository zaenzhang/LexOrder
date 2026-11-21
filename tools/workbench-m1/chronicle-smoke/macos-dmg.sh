#!/usr/bin/env bash
set -euo pipefail

package_dir=${1:?Supply the directory containing the Apple Silicon DMG}
workspace=${2:?Supply a new absolute synthetic workspace}
mode=${3:-}
if [[ "$mode" == "--case-flow" || "$mode" == "--batch" ]]; then
  export LEXORDER_SMOKE_PERFORMANCE_CASEBOOK="$workspace-casebooks"
  mkdir -m 700 "$LEXORDER_SMOKE_PERFORMANCE_CASEBOOK"
fi
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
LEXORDER_SMOKE_RUNTIME_ROOT="${apps[0]}/Contents/Resources/lexorder-runtime" \
LEXORDER_SMOKE_BUN="${apps[0]}/Contents/MacOS/lexorder-bun" \
  bun --no-env-file --no-install "$script_dir/sidecar.mjs" "$workspace"
node "$script_dir/macos-installed.mjs" "${apps[0]}" "$workspace" "$mode"
