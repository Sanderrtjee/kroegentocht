# Backupcontainer.
#
# Basis is het postgres-image, want pg_dump moet dezelfde majorversie hebben als
# de server. Met een oudere pg_dump tegen een nieuwere server weigert hij dienst,
# en met een nieuwere tegen een oudere krijg je een dump die je niet terug kunt
# zetten op het origineel.
FROM postgres:17-alpine

# tini geeft signalen door, zodat docker compose stop niet tien seconden wacht.
RUN apk add --no-cache tini tzdata

COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY restore.sh /usr/local/bin/restore.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh /usr/local/bin/restore.sh

# /backups hier al aanmaken en aan postgres geven. Docker neemt bij een verse
# named volume de eigenaar van het mountpunt in het image over; zonder deze
# regel is het volume van root en kan de container er niet in schrijven.
RUN mkdir -p /backups && chown postgres:postgres /backups

USER postgres

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
