#!/bin/bash
# Double-click to set up (first time) and start Fillco, then open it in the browser.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.fillco-tools/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\n[!] %s\n\nPress Enter to close this window.' "$1"; read -r; exit 1; }

step "Checking Node.js"
command -v node >/dev/null || fail "Node.js is not installed. Install the LTS version from https://nodejs.org and try again."

step "Checking Docker Desktop"
command -v docker >/dev/null || fail "Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop"
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running. Open Docker Desktop, wait until it says it is running, then try again."

if ! command -v pnpm >/dev/null; then
  step "Installing pnpm (one time)"
  npm install -g pnpm@10.33.0 --prefix "$HOME/.fillco-tools" || fail "Could not install pnpm."
fi

[ -f .env ] || cp .env.example .env

step "Starting the database"
docker compose up -d || fail "Could not start the database."
for _ in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U fillco -d fillco_dev >/dev/null 2>&1 && break
  sleep 2
done

step "Installing libraries (the first time takes a few minutes)"
pnpm install || fail "Installing libraries failed."
step "Building the app"
pnpm build || fail "Building the app failed."
step "Preparing the database"
pnpm db:migrate || fail "Preparing the database failed."
pnpm db:seed || fail "Loading demo data failed."

step "Starting Fillco. Your browser opens in a moment. Keep this window open; close it to stop Fillco."
(sleep 25; open http://localhost:3000) &
pnpm start
