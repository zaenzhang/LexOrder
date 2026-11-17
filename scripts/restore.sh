#!/bin/bash
# 仅向停止 Web/worker 的隔离空实例恢复现行 local 备份。
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/local-backup.mjs" restore "$@"
