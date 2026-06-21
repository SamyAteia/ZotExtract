#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <zotero-version>" >&2
  exit 64
fi

export ZOTERO_VERSION="$1"
exec bash scripts/docker-zotero-test.sh
