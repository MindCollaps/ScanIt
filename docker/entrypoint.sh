#!/bin/sh
set -eu

CONFIG_DIR="${SCANIT_CONFIG_DIR:-/config}"
USER_CONFIG="$CONFIG_DIR/scanit.yaml"

# Always ensure the system defaults are present
if [ ! -f "$CONFIG_DIR/00-system.yaml" ]; then
  echo "[scanit] Installing system defaults → $CONFIG_DIR/00-system.yaml"
  cp /app/defaults/00-system.yaml "$CONFIG_DIR/00-system.yaml"
fi

# Create a user config stub if none exists
if [ ! -f "$USER_CONFIG" ]; then
  echo "[scanit] Creating user config stub → $USER_CONFIG"
  cp /app/defaults/scanit.yaml "$USER_CONFIG"
fi

echo "[scanit] Loading config from directory: $CONFIG_DIR"
exec bun /app/dist/server/index.js
