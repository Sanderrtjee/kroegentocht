import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DEDUPE_RADIUS_M,
  venueResolveSchema,
  venueSearchQuerySchema,
} from '@kroegentocht/shared';
import type { VenueDto } from '@kroegentocht/shared';
import { appPool, withTransaction } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import {
  chooseVenueMatch,
  normalizeVenueName,
  venueLockKey,
  type VenueCandidate,
} from '../lib/venue-match.js';

/**
 * Selectie van de kolommen van een venue in de vorm die de frontend verwacht.
 * De geography-kolom wordt nooit rauw uitgeleverd; lat en lon komen uit ST_Y/ST_X.
 */
const VENUE_COLUMNS = `
  id,
  name,
  street,
  city,
  country,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lon,
  osm_id
`;

interface VenueRow {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  osm_id: number | null;
}

function toVenueDto(row: VenueRow): VenueDto {
  return {
    id: row.id,
    name: row.name,
    street: row.street,
    city: row.city,
    country: row.country,
    lat: Number(row.lat),
    lon: Number(row.lon),
    osmId: row.osm_id === null ? null : Number(row.osm_id),
  };
}

const venueRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Zoekt een bestaande tent of maakt een nieuwe aan.
   *
   * De hele beslissing zit in een transactie met een advisory lock op het
   * rastervak van de coordinaten. Twee mensen die op hetzelfde moment dezelfde
   * kroeg vastleggen komen daardoor achter elkaar door deze code, en de tweede
   * ziet de tent die de eerste net aanmaakte. Zonder die lock zouden beide de
   * kandidatenlijst leeg zien en twee duplicaten maken.
   */
  app.post(
    '/resolve',
    { preHandler: app.requireAuth, schema: { body: venueResolveSchema } },
    async (request) => {
      const input = request.body as z.infer<typeof venueResolveSchema>;
      const user = request.currentUser!;
      const result = await resolveVenue(input, user.id);
      return result;
    },
  );

  /** Zoeken op naam, eventueel beperkt tot de buurt. */
  app.get(
    '/search',
    { preHandler: app.requireAuth, schema: { querystring: venueSearchQuerySchema } },
    async (request) => {
      const q = request.query as z.infer<typeof venueSearchQuerySchema>;
      const params: unknown[] = [];
      const where: string[] = [];
      let lonIndex: number | null = null;
      let latIndex: number | null = null;

      if (q.q) {
        // pg_trgm met de GIN-index op name_normalized, plus een gewone
        // substringmatch zodat "zwa" ook "de zwaan" vindt. Dit is een
        // zoeksuggestie, geen beslissing, dus de drempel mag laag zijn.
        params.push(normalizeVenueName(q.q));
        const normalizedIndex = params.length;
        where.push(
          `(name_normalized % $${normalizedIndex} OR name_normalized LIKE '%' || $${normalizedIndex} || '%')`,
        );
      }
      if (q.lat !== undefined && q.lon !== undefined) {
        params.push(q.lon);
        lonIndex = params.length;
        params.push(q.lat);
        latIndex = params.length;
        params.push(q.radius);
        where.push(
          `ST_DWithin(location, ST_SetSRID(ST_MakePoint($${lonIndex}, $${latIndex}), 4326)::geography, $${params.length})`,
        );
      }

      const orderBy =
        lonIndex !== null && latIndex !== null
          ? `location <-> ST_SetSRID(ST_MakePoint($${lonIndex}, $${latIndex}), 4326)::geography`
          : 'name';

      params.push(q.limit);
      const sql = `
        SELECT ${VENUE_COLUMNS}
        FROM venues
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${orderBy}
        LIMIT $${params.length}
      `;

      const rows = await appPool.query<VenueRow>(sql, params);
      return { items: rows.rows.map(toVenueDto) };
    },
  );

  app.get(
    '/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const rows = await appPool.query<VenueRow>(
        `SELECT ${VENUE_COLUMNS} FROM venues WHERE id = $1`,
        [id],
      );
      const row = rows.rows[0];
      if (!row) throw notFound('Deze tent bestaat niet.');
      return toVenueDto(row);
    },
  );
};

export interface ResolveVenueResult {
  venue: VenueDto;
  matched: boolean;
  reason: 'osm_id' | 'exact_normalized_name' | 'similar_name' | 'created';
  similarity: number | null;
}

/**
 * Wordt ook door het aanmaken van een bezoek gebruikt, zodat er maar een plek is
 * waar de deduplicatieregel staat.
 */
export async function resolveVenue(
  input: {
    name: string;
    street?: string | undefined;
    city?: string | undefined;
    country?: string | undefined;
    lat: number;
    lon: number;
    osmId?: number | undefined;
  },
  userId: string,
): Promise<ResolveVenueResult> {
  const normalized = normalizeVenueName(input.name);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [venueLockKey(input.lat, input.lon)]);

    const candidateRows = await client.query<{
      id: string;
      name: string;
      name_normalized: string;
      distance_m: number;
      osm_id: number | null;
    }>(
      `SELECT id, name, name_normalized, osm_id,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
       FROM venues
       WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
          OR ($4::bigint IS NOT NULL AND osm_id = $4::bigint)
       ORDER BY distance_m ASC
       LIMIT 50`,
      [input.lon, input.lat, DEDUPE_RADIUS_M, input.osmId ?? null],
    );

    const candidates: VenueCandidate[] = candidateRows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      nameNormalized: r.name_normalized,
      distanceM: Number(r.distance_m),
      osmId: r.osm_id === null ? null : Number(r.osm_id),
    }));

    const match = chooseVenueMatch({ name: input.name, osmId: input.osmId ?? null }, candidates);

    if (match) {
      const rows = await client.query<VenueRow>(
        `SELECT ${VENUE_COLUMNS} FROM venues WHERE id = $1`,
        [match.candidate.id],
      );
      const row = rows.rows[0];
      if (row) {
        // Een tent zonder osm_id die nu wel een osm_id krijgt aangeleverd,
        // verrijken we. Dat maakt latere deduplicatie zekerder.
        if (input.osmId != null && row.osm_id == null) {
          await client.query('UPDATE venues SET osm_id = $1 WHERE id = $2 AND osm_id IS NULL', [
            input.osmId,
            row.id,
          ]);
          row.osm_id = input.osmId;
        }
        return {
          venue: toVenueDto(row),
          matched: true,
          reason: match.reason,
          similarity: match.similarity,
        };
      }
    }

    try {
      const inserted = await client.query<VenueRow>(
        `INSERT INTO venues (name, name_normalized, street, city, country, location, osm_id, created_by)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8, $9)
         RETURNING ${VENUE_COLUMNS}`,
        [
          input.name.trim(),
          normalized,
          input.street ?? null,
          input.city ?? null,
          input.country ?? null,
          input.lon,
          input.lat,
          input.osmId ?? null,
          userId,
        ],
      );
      const row = inserted.rows[0]!;
      await recordAudit(
        {
          actorUserId: userId,
          action: 'create',
          entityType: 'venue',
          entityId: row.id,
          details: { name: row.name, city: row.city },
        },
        client,
      );
      return { venue: toVenueDto(row), matched: false, reason: 'created', similarity: null };
    } catch (err) {
      // 23505: de unieke index op naam plus rastervak sloeg toe. Dan bestaat de
      // tent toch al en koppelen we daaraan.
      if ((err as { code?: string }).code === '23505') {
        const existing = await client.query<VenueRow>(
          `SELECT ${VENUE_COLUMNS}
           FROM venues
           WHERE name_normalized = $1
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
           ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
           LIMIT 1`,
          [normalized, input.lon, input.lat, DEDUPE_RADIUS_M * 3],
        );
        const row = existing.rows[0];
        if (row) {
          return {
            venue: toVenueDto(row),
            matched: true,
            reason: 'exact_normalized_name',
            similarity: 1,
          };
        }
      }
      throw err;
    }
  });
}

export { toVenueDto, VENUE_COLUMNS };
export type { VenueRow };
export default venueRoutes;
