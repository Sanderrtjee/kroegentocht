# Home Assistant add-on image: PostgreSQL 17 met PostGIS en de Node-api in één
# container, met s6-overlay als procesbeheerder.
#
# Waarom één container: een add-on is per definitie één container. Op een gewone
# Docker-host is compose.yaml met drie losse services de betere vorm; die blijft
# bestaan (ops/api.Dockerfile). Dit bestand is de tweede verpakking om dezelfde
# code, niet een tweede versie van de applicatie.
#
# Let op: deze Dockerfile heet Dockerfile en staat in de root, omdat de
# Supervisor de add-onmap als build-context gebruikt en dus bij de broncode moet
# kunnen. Voor de compose-stack gebruik je ops/api.Dockerfile.

ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm

# --------------------------------------------------------------------- builder
# Bouwen met de officiële node-image. Bewust zonder BuildKit-cachemounts: de
# Supervisor bouwt niet altijd met BuildKit, en dan is een cachemount een
# bouwfout in plaats van een versnelling.
FROM node:22-bookworm-slim AS builder

WORKDIR /build

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/
COPY web/package.json ./web/

RUN npm ci --workspaces --include-workspace-root

COPY . .

RUN npm run build --workspace shared \
 && npm run build --workspace web \
 && npm run build --workspace api

# Opnieuw installeren zonder devDependencies voor de runtime. De mkdir erna:
# npm hijst alles wat het kan naar de root, dus een workspace houdt alleen een
# eigen node_modules bij een versieconflict. Welke dat zijn wisselt, en COPY
# faalt op een ontbrekende bron.
RUN npm ci --workspaces --include-workspace-root --omit=dev \
 && mkdir -p node_modules api/node_modules

# --------------------------------------------------------------------- runtime
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    NODE_ENV=production \
    PGDATA=/data/postgres \
    PATH="/usr/lib/postgresql/17/bin:${PATH}"

# PostgreSQL 17 met PostGIS uit de PGDG-repository. Debian bookworm zelf levert
# 15, en de migraties gaan uit van 17.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        libstdc++6 \
        openssl \
        tzdata; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        postgresql-17 \
        postgresql-17-postgis-3; \
    apt-get purge -y --auto-remove gnupg; \
    rm -rf /var/lib/apt/lists/*; \
    # Het pakket maakt een lege cluster aan op de standaardplek. Die gebruiken we
    # niet: onze data staat in /data/postgres, zodat hij in de backup van de
    # add-on meegaat.
    rm -rf /var/lib/postgresql/17/main /etc/postgresql/17/main

# Alleen de node-runtime, geen npm: de node_modules zijn al gebouwd. Beide images
# zijn op bookworm gebaseerd, dus dezelfde glibc.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node

# De applicatie draait niet als root. Postgres draait onder zijn eigen gebruiker
# die het pakket al aanmaakt.
RUN useradd --system --no-create-home --home-dir /nonexistent \
        --shell /usr/sbin/nologin ktapp

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/shared/package.json ./shared/package.json
COPY --from=builder /build/shared/dist ./shared/dist
COPY --from=builder /build/api/package.json ./api/package.json
COPY --from=builder /build/api/node_modules ./api/node_modules
COPY --from=builder /build/api/dist ./api/dist
COPY --from=builder /build/web/dist ./web/dist
# De migraties horen in het image: de api voert ze zelf uit bij het starten.
COPY --from=builder /build/db/migrations ./db/migrations

# s6-diensten en de opstartscripts.
COPY rootfs /
RUN chmod +x \
    /etc/s6-overlay/scripts/init-config \
    /etc/s6-overlay/scripts/init-postgres \
    /etc/s6-overlay/s6-rc.d/postgres/run \
    /etc/s6-overlay/s6-rc.d/api/run

# Alleen ter documentatie; de Supervisor doet de publicatie op basis van config.yaml.
EXPOSE 3000
