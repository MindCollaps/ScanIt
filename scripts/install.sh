#!/bin/sh

set -eu

REPO="https://github.com/MindCollaps/ScanIt.git"
INSTALL_DIR="${SCANIT_DIR:-$HOME/scanit}"

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'
BOLD='\033[1m'
RESET='\033[0m'

if [ -t 1 ]; then
  COLOR_RED=$RED
  COLOR_GREEN=$GREEN
  COLOR_YELLOW=$YELLOW
  COLOR_BLUE=$BLUE
  COLOR_BOLD=$BOLD
  COLOR_RESET=$RESET
else
  COLOR_RED=''
  COLOR_GREEN=''
  COLOR_YELLOW=''
  COLOR_BLUE=''
  COLOR_BOLD=''
  COLOR_RESET=''
fi

say() {
  printf "%b\n" "$1"
}

fail() {
  say "${COLOR_RED}${COLOR_BOLD}Error:${COLOR_RESET} $1"
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' not found. Please install it and try again."
}

# ── Pre-flight checks ──────────────────────────────────────────

main() {
  say "${COLOR_BOLD}ScanIt Installer${COLOR_RESET}"
  say ""

  os=$(uname -s 2>/dev/null || echo unknown)
  arch=$(uname -m 2>/dev/null || echo unknown)
  say "${COLOR_BLUE}Platform:${COLOR_RESET} ${os}/${arch}"

  need_cmd git
  need_cmd docker

  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon is not running. Start Docker and try again."
  fi

  # Check docker compose (v2 plugin preferred)
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    fail "Neither 'docker compose' (v2) nor 'docker-compose' (v1) found."
  fi

  say "${COLOR_BLUE}Compose:${COLOR_RESET} $COMPOSE"
  say ""

  # ── Clone or update the repo ────────────────────────────────

  if [ -d "$INSTALL_DIR/.git" ]; then
    say "${COLOR_YELLOW}Existing install found at ${INSTALL_DIR}, pulling latest...${COLOR_RESET}"
    git -C "$INSTALL_DIR" pull --ff-only || fail "Git pull failed. Resolve conflicts in ${INSTALL_DIR} and retry."
  else
    say "${COLOR_BLUE}Cloning ScanIt → ${INSTALL_DIR}${COLOR_RESET}"
    git clone "$REPO" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"

  # ── Create host directories for volumes ─────────────────────

  mkdir -p config .data/output .data/db

  # ── Build and start ─────────────────────────────────────────

  say ""
  say "${COLOR_BLUE}Building and starting ScanIt...${COLOR_RESET}"
  $COMPOSE up --build -d

  say ""
  say "${COLOR_GREEN}${COLOR_BOLD}ScanIt is running!${COLOR_RESET}"
  say ""
  say "  Open:   ${COLOR_BOLD}http://localhost:8863${COLOR_RESET}"
  say "  Config: ${COLOR_BOLD}${INSTALL_DIR}/config/scanit.yaml${COLOR_RESET}"
  say "  Logs:   ${COLOR_BOLD}$COMPOSE -f ${INSTALL_DIR}/docker-compose.yml logs -f${COLOR_RESET}"
  say "  Stop:   ${COLOR_BOLD}$COMPOSE -f ${INSTALL_DIR}/docker-compose.yml down${COLOR_RESET}"
  say ""
  say "Add your scanner to ${COLOR_BOLD}config/scanit.yaml${COLOR_RESET} and the app will hot-reload."
}

main "$@"
