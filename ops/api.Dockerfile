# syntax=docker/dockerfile:1.7

# Multi-stage build voor de api, die ook de gebouwde frontend uitserveert.
#
# Basis is node:22-slim (Debian) en niet alpine. sharp en @node-rs/argon2 hebben
# voorgebouwde binaries voor glibc; op musl moeten die gecompileerd worden, wat
# de build minuten kost en op een i5 met 16 GB niet grappig meer is. Slim is
# ongeveer 80 MB basis en dat is klein genoeg.

# ---------------------------------------------------------------- dependencies
FROM node:22-slim AS deps
WORKDIR /app

# Alleen de manifesten kopieren, zodat de laag met node_modules in de cache
# blijft zolang de afhankelijkheden niet wijzigen.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/
COPY web/package.json ./web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root

# npm hijst alles wat het kan naar de root, dus een workspace houdt alleen een
# eigen node_modules als er een versieconflict is. Welke mappen dat zijn hangt af
# van de dependencytree en kan per install verschillen. COPY faalt op een
# ontbrekende bron, dus we zorgen dat ze allemaal bestaan, desnoods leeg.
RUN mkdir -p node_modules api/node_modules web/node_modules shared/node_modules

# ---------------------------------------------------------------------- builder
FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/api/node_modules ./api/node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY . .

# shared eerst: api en web importeren de gebouwde versie.
RUN npm run build --workspace shared \
 && npm run build --workspace web \
 && npm run build --workspace api

# Afhankelijkheden opnieuw, nu zonder devDependencies, voor de runtime-laag.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root --omit=dev \
 && mkdir -p node_modules api/node_modules

# ---------------------------------------------------------------------- runtime
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    MEDIA_ROOT=/var/lib/kroegentocht/media \
    TILE_CACHE_ROOT=/var/lib/kroegentocht/tiles \
    WEB_DIST_PATH=/app/web/dist

# tini als init: zonder pid 1 die signalen doorgeeft blijft node bij een
# docker stop tien seconden hangen voordat hij gekilld wordt.
# curl is voor de healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/api/package.json ./api/package.json
COPY --from=builder /app/api/node_modules ./api/node_modules
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/web/dist ./web/dist
# De migraties horen in het image: de api voert ze zelf uit bij het starten.
COPY --from=builder /app/db/migrations ./db/migrations

# De gebruiker node bestaat al in het image (uid 1000). Alleen de datamappen
# moeten van hem zijn; /app blijft van root en is dus niet schrijfbaar voor de
# applicatie.
RUN mkdir -p /var/lib/kroegentocht/media /var/lib/kroegentocht/tiles \
 && chown -R node:node /var/lib/kroegentocht

USER node

EXPOSE 3000

# TLS wordt door Nginx Proxy Manager afgehandeld, dus http volstaat hier.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "api/dist/index.js"]
