import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { geocodeQuerySchema } from '@kroegentocht/shared';
import type { GeocodeResultDto } from '@kroegentocht/shared';
import { env } from '../config/env.js';
import { fetchWithTimeout, nominatimGate } from '../lib/outbound.js';
import { geocodeRateLimit } from '../plugins/security.js';

/**
 * Zoeken naar een adres via Nominatim, via onze eigen server.
 *
 * Dat de browser niet zelf naar Nominatim gaat is opzet: zo blijft connect-src
 * in de Content Security Policy op 'self', gaat er geen IP-adres van een
 * gebruiker naar een derde partij, en kan het verzoek per seconde dat Nominatim
 * toestaat hier centraal worden afgedwongen.
 *
 * Antwoorden blijven een uur in het geheugen staan. Kroegnamen veranderen niet
 * per minuut, en het scheelt Nominatim werk als drie mensen dezelfde straat
 * zoeken.
 */

interface CacheEntry {
  at: number;
  items: GeocodeResultDto[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

interface NominatimPlace {
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    country?: string;
  };
}

function toDto(place: NominatimPlace): GeocodeResultDto {
  const address = place.address ?? {};
  const street = [address.road, address.house_number].filter(Boolean).join(' ') || null;
  const city =
    address.city ?? address.town ?? address.village ?? address.municipality ?? null;
  return {
    displayName: place.display_name,
    name: place.name && place.name.length > 0 ? place.name : place.display_name.split(',')[0]!,
    lat: Number.parseFloat(place.lat),
    lon: Number.parseFloat(place.lon),
    street,
    city,
    country: address.country ?? null,
    osmId: typeof place.osm_id === 'number' ? place.osm_id : null,
  };
}

const geocodeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/search',
    {
      preHandler: app.requireAuth,
      config: geocodeRateLimit,
      schema: { querystring: geocodeQuerySchema },
    },
    async (request, reply) => {
      const { q, limit } = request.query as z.infer<typeof geocodeQuerySchema>;
      const key = `${q.toLowerCase().trim()}|${limit}`;

      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return { items: hit.items, cached: true };
      }

      const url = new URL('/search', env.NOMINATIM_BASE_URL);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('q', q);

      try {
        const response = await nominatimGate.run(() =>
          fetchWithTimeout(url.toString(), {
            timeoutMs: 8000,
            headers: { accept: 'application/json', 'accept-language': 'nl,en' },
          }),
        );
        if (!response.ok) {
          request.log.warn({ status: response.status }, 'nominatim gaf een fout');
          return reply.status(502).send({
            error: 'bad_gateway',
            message: 'Adressen zoeken lukt nu niet. Zet de marker met de hand op de kaart.',
          });
        }

        const raw = (await response.json()) as NominatimPlace[];
        const items = raw
          .filter((p) => Number.isFinite(Number.parseFloat(p.lat)))
          .map(toDto);

        if (cache.size >= CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { at: Date.now(), items });

        return { items, cached: false };
      } catch (err) {
        request.log.warn({ err }, 'nominatim onbereikbaar');
        return reply.status(502).send({
          error: 'bad_gateway',
          message: 'Adressen zoeken lukt nu niet. Zet de marker met de hand op de kaart.',
        });
      }
    },
  );
};

export default geocodeRoutes;
