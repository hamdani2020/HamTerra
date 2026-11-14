#!/bin/sh
# Runs database migrations, then execs the given command (uvicorn).
# Set MIGRATE_ON_START=false to skip migrations.
set -eu

if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
    echo "Running alembic upgrade head"
    if ! alembic upgrade head 2>&1; then
        echo "Migration failed; not starting the application" >&2
        exit 1
    fi
else
    echo "MIGRATE_ON_START=false: skipping migrations"
fi

exec "$@"
