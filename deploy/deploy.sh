#!/bin/sh
# From a checkout on the dev machine: copy the code to the server, rebuild, restart.
# Runtime data on the server (data/) is never overwritten; only the label files from the repo are synced.
# Usage: deploy/deploy.sh            (needs ssh access as root to the box)
set -e
HOST=${DEPLOY_HOST:-root@193.233.233.118}
SSH="ssh -i ${DEPLOY_KEY:-$HOME/.ssh/id_ed25519} -o IdentitiesOnly=yes -o BatchMode=yes"
cd "$(dirname "$0")/.."
npm run --silent check
for d in src public scripts seed deploy; do
  rsync -rlt --delete --exclude '._*' --exclude '.DS_Store' -e "$SSH" "$d/" "$HOST:/opt/tracehound/$d/"
done
rsync -lt -e "$SSH" package.json package-lock.json tsconfig.json "$HOST:/opt/tracehound/"
rsync -lt -e "$SSH" data/labels.json data/labels-open.json data/labels-cex.json "$HOST:/opt/tracehound/data/"
$SSH "$HOST" 'cd /opt/tracehound && chmod +x deploy/*.sh && docker compose -f deploy/compose.yaml up -d --build && docker image prune -f >/dev/null && sleep 3 && curl -sf -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:8797/api/credits'
