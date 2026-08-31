#!/bin/sh
set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required: https://bun.sh/docs/installation" >&2
  exit 1
fi

bun install

if [ ! -f config.json ]; then
  cp config.example.json config.json
  chmod 600 config.json
  echo "Created config.json; fill in the Google and Notion settings before using the CLI."
fi

if [ "${1:-}" = "--with-d1" ]; then
  bun scripts/setup-workout-state.ts --persist-token
else
  echo "Local setup complete. Run scripts/setup.sh --with-d1 after exporting CLOUDFLARE_API_TOKEN."
fi
