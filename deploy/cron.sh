#!/bin/sh
# Host cron entry for jobs that are not part of the running services.
#   17 12 * * *  /opt/tracehound/deploy/cron.sh smart   daily ring scan (~2k Helius credits)
cd /opt/tracehound || exit 1
case "$1" in
  smart) docker compose -f deploy/compose.yaml exec -T web node src/smart-cli.ts 2>&1 | grep -E "winners:|ring|RING|wallets checked|helius:|skipped" ;;
  *) echo "usage: cron.sh smart" >&2; exit 2 ;;
esac | sed "s/^/$(date -u +%FT%TZ) /" >> /opt/tracehound/data/cron.log
