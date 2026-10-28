#!/usr/bin/env bash
# Corre en el droplet como lukacash. Uso: activar.sh <sha>
set -euo pipefail
SHA="$1"; BASE=/opt/luka-cash/api; NEW="$BASE/releases/$SHA"
PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"
set -a; . /etc/luka-cash/env; set +a
cd "$NEW" && node dist/migrate.js
ln -sfn "$NEW" "$BASE/current"
sudo /bin/systemctl restart luka-cash-api
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3001/health | grep -q '"ok":true'; then echo "release $SHA activo"; ls -1dt "$BASE"/releases/* | tail -n +6 | xargs -r rm -rf; exit 0; fi
  sleep 1
done
echo "health falló; vuelvo a $PREV" >&2
if [ -n "$PREV" ]; then ln -sfn "$PREV" "$BASE/current"; sudo /bin/systemctl restart luka-cash-api; fi
exit 1
