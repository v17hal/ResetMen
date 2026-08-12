#!/bin/sh
# Nightly backup of the database and the uploaded media.
#
# Runs as its own container rather than a host cron so it ships with the stack and cannot
# be forgotten on a rebuild.
#
# Two things this does that a bare `pg_dump` does not:
#
#   1. Writes to a temporary name and renames on success. A dump interrupted halfway
#      through leaves a plausible-looking file that restores into a half-empty database,
#      and you find out on the day you need it.
#   2. Verifies the dump is readable before deleting anything older. A retention policy
#      that prunes good backups to make room for broken ones is worse than none.
#
# Restoring is deliberately a separate, documented script — see restore.sh. A backup nobody
# has ever restored is a hypothesis, not a backup.

set -eu

BACKUP_DIR=/backups
MEDIA_DIR=/media
RETENTION_DAYS="${RETENTION_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

log() { echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

run_backup() {
  stamp="$(date -u '+%Y%m%d-%H%M%S')"
  db_tmp="${BACKUP_DIR}/.db-${stamp}.dump.partial"
  db_out="${BACKUP_DIR}/db-${stamp}.dump"

  log "dumping database"
  # Custom format: compressed, and restorable table-by-table with pg_restore, which is what
  # you want at 2am when only one table is wrong.
  if ! pg_dump -h postgres -U reset -d reset --format=custom --compress=9 --file="$db_tmp"; then
    log "ERROR dump failed; keeping previous backups"
    rm -f "$db_tmp"
    return 1
  fi

  # Reads the archive's table of contents. Catches a truncated or corrupt dump now rather
  # than during a restore.
  if ! pg_restore --list "$db_tmp" >/dev/null 2>&1; then
    log "ERROR dump is not readable; keeping previous backups"
    rm -f "$db_tmp"
    return 1
  fi

  mv "$db_tmp" "$db_out"
  log "wrote $(basename "$db_out") ($(du -h "$db_out" | cut -f1))"

  if [ -d "$MEDIA_DIR" ]; then
    media_tmp="${BACKUP_DIR}/.media-${stamp}.tar.gz.partial"
    media_out="${BACKUP_DIR}/media-${stamp}.tar.gz"

    if tar -czf "$media_tmp" -C "$MEDIA_DIR" . 2>/dev/null; then
      mv "$media_tmp" "$media_out"
      log "wrote $(basename "$media_out") ($(du -h "$media_out" | cut -f1))"
    else
      log "WARN media archive failed; database backup is still good"
      rm -f "$media_tmp"
    fi
  fi

  # Only prunes once a verified dump exists above.
  deleted=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
  find "$BACKUP_DIR" -maxdepth 1 -name '*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete
  # Sweep aborted runs from a previous crash.
  find "$BACKUP_DIR" -maxdepth 1 -name '.*.partial' -mtime +1 -delete

  log "pruned ${deleted} dump(s) older than ${RETENTION_DAYS} days"
  log "backup complete"
}

log "starting; interval ${INTERVAL}s, retention ${RETENTION_DAYS} days"

# One immediately on boot, so a fresh deploy has a restore point before the first customer
# rather than after the first night.
while true; do
  run_backup || log "backup run failed; will retry next interval"
  sleep "$INTERVAL"
done
