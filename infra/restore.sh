#!/bin/sh
# Restore from a backup — and, more usefully, rehearse one.
#
# A backup nobody has ever restored is a hypothesis. This script exists so the restore is
# something the client has actually watched work, on a boring Tuesday, before the day it
# matters.
#
#   Rehearse (safe — restores into a scratch database, touches nothing live):
#     docker compose -f infra/docker-compose.prod.yml run --rm \
#       -v ./infra/restore.sh:/restore.sh backup sh /restore.sh --rehearse
#
#   Restore for real (destructive — replaces the live database):
#     docker compose -f infra/docker-compose.prod.yml run --rm \
#       -v ./infra/restore.sh:/restore.sh backup sh /restore.sh --confirm db-20260812-020000.dump
#
# The real restore refuses to run without both --confirm and an explicit filename. There is
# no "latest" shortcut on purpose: choosing the file is the moment you notice the newest
# backup is from before the incident.

set -eu

BACKUP_DIR=/backups
MODE=""
FILE=""

log() { echo "[restore] $*"; }
die() { echo "[restore] ERROR $*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --rehearse) MODE=rehearse ;;
    --confirm)  MODE=confirm ;;
    -*)         die "unknown flag $arg" ;;
    *)          FILE="$arg" ;;
  esac
done

[ -n "$MODE" ] || die "pass --rehearse (safe) or --confirm <file> (destructive)"

if [ -z "$FILE" ]; then
  [ "$MODE" = "rehearse" ] || die "a real restore needs an explicit filename"
  FILE="$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -n1 || true)"
  [ -n "$FILE" ] || die "no backups found in $BACKUP_DIR"
  FILE="$(basename "$FILE")"
fi

ARCHIVE="${BACKUP_DIR}/${FILE}"
[ -f "$ARCHIVE" ] || die "$ARCHIVE does not exist"

log "archive: $FILE ($(du -h "$ARCHIVE" | cut -f1))"
pg_restore --list "$ARCHIVE" >/dev/null 2>&1 || die "archive is unreadable — do not trust it"

if [ "$MODE" = "rehearse" ]; then
  SCRATCH="reset_restore_check"
  log "rehearsing into $SCRATCH (the live database is untouched)"

  psql -h postgres -U reset -d postgres -c "DROP DATABASE IF EXISTS ${SCRATCH};" >/dev/null
  psql -h postgres -U reset -d postgres -c "CREATE DATABASE ${SCRATCH};" >/dev/null

  # btree_gist must exist before the exclusion constraint can be recreated. If this step
  # is what fails, the backup is fine and the extension is missing — worth telling apart.
  psql -h postgres -U reset -d "$SCRATCH" -c "CREATE EXTENSION IF NOT EXISTS btree_gist;" >/dev/null

  if ! pg_restore -h postgres -U reset -d "$SCRATCH" --no-owner --no-privileges "$ARCHIVE" 2>/tmp/restore.log; then
    log "pg_restore reported problems:"
    tail -n 20 /tmp/restore.log
  fi

  log "--- what came back ---"
  psql -h postgres -U reset -d "$SCRATCH" -tA -c "
    SELECT 'bookings: ' || count(*) FROM bookings
    UNION ALL SELECT 'users: ' || count(*) FROM users
    UNION ALL SELECT 'payments: ' || count(*) FROM payments
    UNION ALL SELECT 'services: ' || count(*) FROM services;
  " || log "WARN could not count rows — the schema may be incomplete"

  # The guarantee the whole product rests on. A restore that brings back the rows but not
  # this constraint is a database that will happily double-book a station.
  CONSTRAINT_COUNT=$(psql -h postgres -U reset -d "$SCRATCH" -tA -c "
    SELECT count(*) FROM pg_constraint WHERE contype = 'x' AND conrelid = 'bookings'::regclass;
  " 2>/dev/null || echo 0)

  if [ "$CONSTRAINT_COUNT" -ge 1 ]; then
    log "OK exclusion constraint restored — no-double-booking is intact"
  else
    log "FAIL exclusion constraint is MISSING. This backup would restore a database that can double-book."
    psql -h postgres -U reset -d postgres -c "DROP DATABASE IF EXISTS ${SCRATCH};" >/dev/null
    exit 1
  fi

  psql -h postgres -U reset -d postgres -c "DROP DATABASE IF EXISTS ${SCRATCH};" >/dev/null
  log "rehearsal passed. Scratch database dropped."
  exit 0
fi

# ── Destructive path ──────────────────────────────────────────────────────────
log "RESTORING OVER THE LIVE DATABASE from $FILE"
log "Stop the API first, or it will write into a database that is being replaced."
log "Continuing in 10 seconds — Ctrl-C to abort."
sleep 10

# A dump of what is about to be destroyed. If the restore turns out to be the wrong file,
# this is the only way back.
SAFETY="${BACKUP_DIR}/pre-restore-$(date -u '+%Y%m%d-%H%M%S').dump"
log "taking a safety dump first: $(basename "$SAFETY")"
pg_dump -h postgres -U reset -d reset --format=custom --compress=9 --file="$SAFETY"

psql -h postgres -U reset -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = 'reset' AND pid <> pg_backend_pid();
" >/dev/null

psql -h postgres -U reset -d postgres -c "DROP DATABASE IF EXISTS reset;" >/dev/null
psql -h postgres -U reset -d postgres -c "CREATE DATABASE reset;" >/dev/null
psql -h postgres -U reset -d reset -c "CREATE EXTENSION IF NOT EXISTS btree_gist;" >/dev/null

pg_restore -h postgres -U reset -d reset --no-owner --no-privileges "$ARCHIVE"

log "restore complete. Start the API and check /api/v1/health/ready."
log "the pre-restore state is in $(basename "$SAFETY") if this was the wrong file."
