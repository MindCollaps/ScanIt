#!/usr/bin/env bash
set -euo pipefail

echo "Installing Bun..."
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  sane-utils ca-certificates avahi-utils libavahi-client3 img2pdf imagemagick

echo "Installing project dependencies..."
bun install

echo "Setup complete!"
