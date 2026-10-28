#!/bin/sh
# Corre un comando con la base de desarrollo, leyendo ~/.luka-cash sin imprimir secretos.
set -a; . "$HOME/.luka-cash/dev.env"; set +a
export DATABASE_CA_FILE="$HOME/.luka-cash/ca-dev.crt"
exec "$@"
