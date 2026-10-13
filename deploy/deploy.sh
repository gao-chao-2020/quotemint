#!/usr/bin/env bash
# QuoteMint deploy (run from your dev machine, inside the repo checkout).
#
# Usage: deploy/deploy.sh SERVER_HOST SERVER_USER [SSH_PORT]
#
# Packs git HEAD (src, public, scripts, package.json) into a tarball, copies it
# to the server, extracts it over /opt/quotemint/app (the server-side .env and
# /opt/quotemint/data are never touched), runs npm install, restarts the
# quotemint service, and waits for /healthz. Non-zero exit on any failure.
#
# Tip: set up SSH key auth once: ssh-copy-id -p PORT USER@HOST

set -euo pipefail

SERVER_HOST="${1:-}"
SERVER_USER="${2:-}"
SSH_PORT="${3:-22}"

if [ -z "$SERVER_HOST" ] || [ -z "$SERVER_USER" ]; then
  echo "usage: deploy/deploy.sh SERVER_HOST SERVER_USER [SSH_PORT]" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/quotemint/app
LOCAL_TARBALL="${TMPDIR:-/tmp}/quotemint-release-$$.tar.gz"
REMOTE_TARBALL=/tmp/quotemint-release.tar.gz
trap 'rm -f "$LOCAL_TARBALL"' EXIT

cd "$REPO_DIR"
git archive --format=tar.gz -o "$LOCAL_TARBALL" HEAD src public scripts package.json
echo "packed $(git rev-parse --short HEAD) -> $LOCAL_TARBALL"

scp -P "$SSH_PORT" "$LOCAL_TARBALL" "$SERVER_USER@$SERVER_HOST:$REMOTE_TARBALL"
echo "uploaded to $SERVER_HOST, running remote steps..."

ssh -p "$SSH_PORT" "$SERVER_USER@$SERVER_HOST" bash -s -- "$APP_DIR" "$REMOTE_TARBALL" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"
TARBALL="$2"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo"
  else
    echo "error: run as root, or configure passwordless sudo (this script reads stdin)" >&2
    exit 1
  fi
fi

mkdir -p "$APP_DIR" /opt/quotemint/data
tar -xzf "$TARBALL" -C "$APP_DIR"
rm -f "$TARBALL"

cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

$SUDO systemctl restart quotemint

PORT_NUM=3000
if [ -f "$APP_DIR/.env" ]; then
  env_port="$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$APP_DIR/.env" | tail -1)"
  if [ -n "$env_port" ]; then
    PORT_NUM="$env_port"
  fi
fi

healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT_NUM/healthz" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "$healthy" -ne 1 ]; then
  echo "deploy FAILED: /healthz did not answer on port $PORT_NUM within 10s. Recent logs:" >&2
  $SUDO journalctl -u quotemint -n 30 --no-pager || true
  exit 1
fi

echo "deploy OK: app live at $APP_DIR, healthy on port $PORT_NUM"
REMOTE
