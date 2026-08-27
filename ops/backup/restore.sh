#!/bin/sh
# Zet een backup terug. Dit script zit in de backupcontainer, zodat herstellen
# geen gedoe is met versies van pg_restore.
#
# Gebruik:
#
#   # welke backups zijn er
#   docker compose exec backup ls -lh /backups
#
#   # database terugzetten (de api eerst stoppen)
#   docker compose stop api
#   docker compose exec backup /usr/local/bin/restore.sh db /backups/db-20260826-033000.dump
#   docker compose start api
#
#   # media terugzetten: de map is read-only gemount in deze container, dus dat
#   # gaat via een losse container. Zie de README, sectie Herstel.
#
# Een restore van de database gooit de bestaande inhoud weg. Daarom is
# --clean --if-exists nodig en vraagt het script om een expliciete bevestiging,
# tenzij FORCE=1 is meegegeven.

set -eu

log() {
    echo "[restore $(date '+%Y-%m-%d %H:%M:%S')] $*"
}

usage() {
    echo "Gebruik: restore.sh db <pad naar .dump>"
    echo "         restore.sh check <pad naar .dump>   (alleen de inhoud tonen)"
    exit 1
}

[ $# -ge 2 ] || usage

mode="$1"
file="$2"

[ -f "${file}" ] || {
    log "FOUT: ${file} bestaat niet"
    exit 1
}

case "${mode}" in
    check)
        log "inhoud van ${file}:"
        pg_restore --list "${file}" | head -50
        log "(eerste 50 regels)"
        ;;
    db)
        if [ "${FORCE:-0}" != "1" ]; then
            printf 'Dit overschrijft de database %s op %s. Typ JA om door te gaan: ' \
                "${PGDATABASE}" "${PGHOST}"
            read -r answer
            [ "${answer}" = "JA" ] || {
                log "afgebroken"
                exit 1
            }
        fi

        log "terugzetten van ${file} in ${PGDATABASE}"
        # --clean --if-exists: bestaande objecten eerst weg, zonder te klagen als
        # ze er niet zijn. --no-owner omdat de dump ook zonder eigenaren is gemaakt.
        # Fouten over het niet kunnen verwijderen van extensies zijn normaal en
        # daarom staat --exit-on-error er niet.
        pg_restore \
            --dbname="${PGDATABASE}" \
            --clean --if-exists \
            --no-owner --no-privileges \
            --jobs=2 \
            "${file}" || log "pg_restore gaf waarschuwingen; controleer de uitvoer hierboven"

        log "klaar. Start de api opnieuw; die voert de migraties zelf weer uit."
        log "Let op: de rol kroeg_public en zijn rechten worden door de migratie"
        log "opnieuw gezet, dus die hoef je niet met de hand te herstellen."
        ;;
    *)
        usage
        ;;
esac
