#!/bin/sh
# Draait de backup elke dag op het ingestelde tijdstip.
#
# Bewust geen cron: een cron-daemon in een container betekent een tweede
# logstroom die niet in docker logs terechtkomt, en een tijdzone die je apart
# moet regelen. Een lus die uitrekent hoeveel seconden het nog is tot het
# volgende tijdstip is even betrouwbaar en volledig te volgen in de logs.

set -eu

BACKUP_AT="${BACKUP_AT:-03:30}"
BACKUP_ON_START="${BACKUP_ON_START:-true}"

log() {
    echo "[backup-scheduler $(date '+%Y-%m-%d %H:%M:%S')] $*"
}

case "${BACKUP_AT}" in
    [0-2][0-9]:[0-5][0-9]) ;;
    *)
        log "FOUT: BACKUP_AT moet de vorm UU:MM hebben, kreeg '${BACKUP_AT}'"
        exit 1
        ;;
esac

log "tijdzone $(date '+%Z'), dagelijkse backup om ${BACKUP_AT}, retentie ${RETENTION_DAYS:-14} dagen"

if [ "${BACKUP_ON_START}" = "true" ]; then
    log "eerste backup nu, zodat direct duidelijk is of het werkt"
    /usr/local/bin/backup.sh || log "de eerste backup mislukte, de lus gaat wel door"
fi

while true; do
    now=$(date +%s)
    # date -d werkt in busybox met "HH:MM" voor vandaag.
    today_target=$(date -d "${BACKUP_AT}" +%s 2>/dev/null || echo "")
    if [ -z "${today_target}" ]; then
        log "FOUT: kan ${BACKUP_AT} niet omrekenen naar een tijdstip"
        exit 1
    fi

    if [ "${today_target}" -le "${now}" ]; then
        # Vandaag al voorbij, dus morgen.
        target=$((today_target + 86400))
    else
        target="${today_target}"
    fi

    sleep_seconds=$((target - now))
    log "volgende backup over ${sleep_seconds} seconden"
    sleep "${sleep_seconds}"

    /usr/local/bin/backup.sh || log "backup mislukt, volgende poging morgen"
done
