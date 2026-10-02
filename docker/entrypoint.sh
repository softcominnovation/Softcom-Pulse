#!/bin/sh
set -eu
cd /app
node docker/migrate.mjs
exec "$@"
