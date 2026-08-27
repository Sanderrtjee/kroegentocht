import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { OSM_ATTRIBUTION, tileParamsSchema } from '@kroegentocht/shared';
import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { fetchWithTimeout, tileLimiter } from '../lib/outbound.js';

/**
 * Cachende tileproxy.
 *
 * Waarom een eigen proxy en niet direct naar tile.openstreetmap.org:
 *
 * - Het gebruiksbeleid van OpenStreetMap verwacht dat je hun tiles cachet en
 *   niet elke pan opnieuw ophaalt. Een gecachete tile gaat hier dertig dagen mee.
 * - De browser praat alleen met onze eigen origin, dus de Content Security Policy
 *   kan connect-src en img-src op 'self' houden en er lekt geen referrer of
 *   IP-adres van een gebruiker naar een derde partij.
 * - De uitgaande verzoeken hebben een identificeerbare User-Agent en een lage
 *   parallelliteit, zoals hun beleid vraagt.
 *
 * Er wordt niet vooruit gecachet en niet in bulk gedownload: alleen tiles die
 * iemand daadwerkelijk in beeld heeft.
 */

const TTL_MS = env.TILE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

function cachePath(z: number, x: number, y: number): string {
  return path.join(env.TILE_CACHE_ROOT, String(z), String(x), `${y}.png`);
}

function upstreamUrl(z: number, x: number, y: number): string {
  return env.TILE_UPSTREAM_TEMPLATE.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

async function cacheAge(file: string): Promise<number | null> {
  try {
    const s = await stat(file);
    return Date.now() - s.mtimeMs;
  } catch {
    return null;
  }
}

const tileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/attribution', { config: { rateLimit: false } }, async () => ({
    attribution: OSM_ATTRIBUTION,
    upstream: env.TILE_UPSTREAM_TEMPLATE,
    cacheTtlDays: env.TILE_CACHE_TTL_DAYS,
  }));

  app.get(
    '/:z/:x/:y.png',
    {
      preHandler: app.requireAuth,
      // Tiles komen in bursts van tientallen per kaartbeweging; de globale
      // limiet is daar te streng voor.
      config: { rateLimit: { max: 2000, timeWindow: '1 minute' } },
      schema: { params: tileParamsSchema },
    },
    async (request, reply) => {
      const { z, x, y } = request.params as { z: number; x: number; y: number };

      const max = 2 ** z;
      if (x >= max || y >= max) throw badRequest('Tilecoordinaten vallen buiten dit zoomniveau.');

      const file = cachePath(z, x, y);
      const age = await cacheAge(file);

      if (age !== null && age < TTL_MS) {
        return reply
          .type('image/png')
          .header('cache-control', 'public, max-age=604800')
          .header('x-tile-cache', 'hit')
          .send(createReadStream(file));
      }

      try {
        const response = await tileLimiter.run(() =>
          fetchWithTimeout(upstreamUrl(z, x, y), { timeoutMs: 8000 }),
        );
        if (!response.ok) {
          throw new Error(`upstream gaf ${response.status}`);
        }
        const body = Buffer.from(await response.arrayBuffer());

        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, body);
        await rename(temporary, file);

        return reply
          .type('image/png')
          .header('cache-control', 'public, max-age=604800')
          .header('x-tile-cache', age === null ? 'miss' : 'refresh')
          .send(body);
      } catch (err) {
        // Liever een tile van vorige maand dan een gat in de kaart.
        if (age !== null) {
          request.log.warn({ err, z, x, y }, 'tile verversen mislukt, verouderde cache gebruikt');
          return reply
            .type('image/png')
            .header('cache-control', 'public, max-age=3600')
            .header('x-tile-cache', 'stale')
            .send(createReadStream(file));
        }
        request.log.error({ err, z, x, y }, 'tile ophalen mislukt');
        return reply.status(502).send({
          error: 'bad_gateway',
          message: 'Kaarttegel kon niet worden opgehaald.',
        });
      }
    },
  );
};

export default tileRoutes;
