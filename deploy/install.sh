#!/usr/bin/env bash
# QuoteMint server bootstrap for Ubuntu 22.04/24.04 (run once, as root).
# QuoteMint 服务器初始化脚本（Ubuntu 22.04/24.04，以 root 运行一次）。存档：自建服务器路线已搁置；当前生产 = Netlify + Neon。
# Installs Node 24, creates /opt/quotemint, and installs the quotemint systemd service.
# 安装 Node 24、创建 /opt/quotemint、注册 quotemint systemd 服务。
# Idempotent: safe to re-run (an existing .env is preserved).
# 幂等：可安全重复运行（已有的 .env 不会被覆盖）。
#
# Usage: sudo bash deploy/install.sh
# 用法：sudo bash deploy/install.sh

set -euo pipefail

# Pin the exact Node 24 build we develop and test on. Bump deliberately.
NODE_VERSION=24.14.0

APP_DIR=/opt/quotemint/app
DATA_DIR=/opt/quotemint/data

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (sudo bash deploy/install.sh)" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "error: this script targets Ubuntu/Debian (apt-get not found)" >&2
  exit 1
fi

node_version=""
if command -v node >/dev/null 2>&1; then
  node_version="$(node -v)"
fi

# 24 or newer (accepts 24.x through 99.x)
if [[ "$node_version" =~ ^v(2[4-9]|[3-9][0-9])\. ]]; then
  echo "node $node_version already installed, skipping install"
  need_node=0
else
  need_node=1
fi

need_apt=0
if ! command -v curl >/dev/null 2>&1; then
  need_apt=1
fi
if [ "$need_node" -eq 1 ] && ! command -v xz >/dev/null 2>&1; then
  need_apt=1
fi
if [ "$need_apt" -eq 1 ]; then
  apt-get update -y
  apt-get install -y --no-install-recommends curl ca-certificates xz-utils
fi

if [ "$need_node" -eq 1 ]; then
  case "$(uname -m)" in
    x86_64) node_arch=linux-x64 ;;
    aarch64|arm64) node_arch=linux-arm64 ;;
    *)
      echo "error: unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac

  tarball="node-v${NODE_VERSION}-${node_arch}.tar.xz"
  # npmmirror first (reliable from mainland CN); nodejs.org as fallback.
  url="https://registry.npmmirror.com/mirrors/node/v${NODE_VERSION}/${tarball}"
  echo "downloading node $NODE_VERSION from $url"
  if ! curl -fSL --retry 3 -o "/tmp/${tarball}" "$url"; then
    url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
    echo "npmmirror failed, retrying from $url"
    curl -fSL --retry 3 -o "/tmp/${tarball}" "$url"
  fi

  tar -xJf "/tmp/${tarball}" -C /usr/local --strip-components=1
  rm -f "/tmp/${tarball}"
  echo "installed node $(node -v), npm $(npm -v)"
fi

mkdir -p "$APP_DIR" "$DATA_DIR"

cat >/etc/systemd/system/quotemint.service <<'UNIT'
[Unit]
Description=QuoteMint
After=network.target

[Service]
WorkingDirectory=/opt/quotemint/app
ExecStart=/usr/bin/env node --no-warnings src/server.js
EnvironmentFile=-/opt/quotemint/app/.env
Restart=always
RestartSec=3
# v0: runs as root on a single-tenant trial server. Harden later with a dedicated user.
User=root

[Install]
WantedBy=multi-user.target
UNIT

if [ ! -f "$APP_DIR/.env" ]; then
  cat >"$APP_DIR/.env" <<'ENV'
# Written by deploy/install.sh. Full reference: deploy/env.production.example
PORT=3000
BASE_URL=https://quotemint.dpdns.org
NODE_ENV=production
DEMO_MODE=false
TRUST_PROXY=1
DATA_DIR=/opt/quotemint/data
ENV
  echo "wrote default $APP_DIR/.env (edit BASE_URL if your domain differs)"
fi

systemctl daemon-reload
systemctl enable quotemint.service
systemctl restart quotemint.service || true

echo
echo "bootstrap done (node $(node -v))."
echo "Next steps:"
echo "  1. Ship the app from your dev machine: deploy/deploy.sh <server-ip> root"
echo "  2. Optional: scp your Alipay QR to $APP_DIR/public/alipay-qr.png (shows the billing card)"
echo "  3. Billing keys / DATABASE_URL go in $APP_DIR/.env, then: systemctl restart quotemint"
echo "  4. Expose it on https: follow deploy/CLOUDFLARE-TUNNEL.md"
echo "  Note: the service is enabled now; it crash-loops harmlessly until step 1 ships the app."
