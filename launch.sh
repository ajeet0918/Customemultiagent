#!/usr/bin/env bash
set -euo pipefail
studio_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$studio_root/node_modules/electron/dist/electron" ]]; then
  exec "$studio_root/node_modules/electron/dist/electron" "$studio_root" "$@"
fi
cd "$studio_root"
exec npm start -- "$@"
