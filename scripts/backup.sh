#!/bin/bash
# Server PostgreSQL 与本地原件备份；配置和主密钥须独立保管。
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/local-backup.mjs" backup "$@"
