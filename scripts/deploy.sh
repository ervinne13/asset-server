#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Error: .env not found." >&2
  exit 1
fi

set -a
source .env
set +a

SSH_ARGS="-p ${SSH_PORT:-22} -o StrictHostKeyChecking=accept-new"

# Auth: password via sshpass (SSHPASS env var), or key, or default agent
if [ -n "$SSH_PASSWORD" ]; then
  if ! command -v sshpass &>/dev/null; then
    echo "Error: sshpass is required for password auth — brew install sshpass" >&2
    exit 1
  fi
  export SSHPASS="$SSH_PASSWORD"
  SSHPASS_PREFIX="sshpass -e"
elif [ -n "$SSH_KEY" ]; then
  SSH_ARGS="$SSH_ARGS -i $SSH_KEY"
  SSHPASS_PREFIX=""
else
  SSHPASS_PREFIX=""
fi

DEST="${SSH_USER:-ervinne}@${SSH_HOST:?SSH_HOST is required}"

echo "→ Syncing to $DEST:$REMOTE_PATH"

$SSHPASS_PREFIX rsync -az --progress \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='node_modules/' \
  --exclude='config.json' \
  --exclude='index/' \
  -e "ssh $SSH_ARGS" \
  . "$DEST:$REMOTE_PATH"

echo "→ Installing dependencies"
$SSHPASS_PREFIX ssh $SSH_ARGS "$DEST" "bash -l -c 'cd $REMOTE_PATH && npm install --omit=dev'"

echo "→ Restarting service"
$SSHPASS_PREFIX ssh $SSH_ARGS "$DEST" "sudo systemctl restart asset-server"

echo "✓ Deployed → http://$SSH_HOST:${SERVER_PORT:-3000}"
