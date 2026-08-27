#!/bin/sh
# Maakt een backup van de database en de mediamap.
#
# De dump is het custom formaat van pg_dump (-Fc). Dat is gecomprimeerd en laat
# pg_restore selectief terugzetten, wat handig is als je alleen een tabel kwijt
# bent. De media gaan als tar.gz mee, want dat zijn de bestanden waar geen enkele
# database-dump iets over zegt.
#
# Beide bestanden krijgen een tijdstempel in de naam en worden pas op hun
# definitieve naam gezet als ze volledig geschreven zijn. Een backup die
# halverwege afbrak ligt er dus niet als geldige backup bij.

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MEDIA_DIR="${MEDIA_DIR:-/data/media}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

stamp="$(date +%Y%m%d-%H%M%S)"
db_target="${BACKUP_DIR}/db-${stamp}.dump"
media_target="${BACKUP_DIR}/media-${stamp}.tar.gz"

log() {
    echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "start, database ${PGDATABASE} op ${PGHOST}"

mkdir -p "${BACKUP_DIR}"

# --- database -------------------------------------------------------------
tmp_db="${db_target}.partial"
if pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="${tmp_db}"; then
    mv "${tmp_db}" "${db_target}"
    log "database gedumpt naar $(basename "${db_target}") ($(du -h "${db_target}" | cut -f1))"
else
    rm -f "${tmp_db}"
    log "FOUT: pg_dump mislukt"
    exit 1
fi

# --- media ----------------------------------------------------------------
if [ -d "${MEDIA_DIR}" ]; then
    tmp_media="${media_target}.partial"
    # -C zodat de paden in het archief relatief zijn en een restore niet
    # afhankelijk is van waar de map toevallig gemount stond.
    if tar -czf "${tmp_media}" -C "${MEDIA_DIR}" .; then
        mv "${tmp_media}" "${media_target}"
        log "media gearchiveerd naar $(basename "${media_target}") ($(du -h "${media_target}" | cut -f1))"
    else
        rm -f "${tmp_media}"
        log "FOUT: archiveren van de media mislukt"
        exit 1
    fi
else
    log "waarschuwing: ${MEDIA_DIR} bestaat niet, media overgeslagen"
fi

# --- opruimen -------------------------------------------------------------
# Alleen bestanden die aan het naampatroon voldoen, zodat een handmatig
# neergezette kopie niet stil wordt opgeruimd.
removed=0
for pattern in 'db-*.dump' 'media-*.tar.gz'; do
    # shellcheck disable=SC2086
    for old in $(find "${BACKUP_DIR}" -maxdepth 1 -name "${pattern}" -type f -mtime "+${RETENTION_DAYS}"); do
        rm -f "${old}"
        log "verwijderd wegens retentie: $(basename "${old}")"
        removed=$((removed + 1))
    done
done

count=$(find "${BACKUP_DIR}" -maxdepth 1 -name 'db-*.dump' -type f | wc -l | tr -d ' ')
total=$(du -sh "${BACKUP_DIR}" | cut -f1)
log "klaar. ${count} dumps bewaard, ${removed} opgeruimd, ${total} in totaal"
