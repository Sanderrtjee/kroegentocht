import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  heatmapQuerySchema,
  mapBboxQuerySchema,
  nearbyQuerySchema,
  venueReportsQuerySchema,
} from '@kroegentocht/shared';
import type { HeatPointDto, MineMapFeature } from '@kroegentocht/shared';
import { appPool, publicPool } from '../db/client.js';
import { toPublicMapFeatures, toPublicReport } from '../lib/anonymize.js';
import { fetchVisitsByIds } from '../lib/visit-queries.js';

/**
 * Kaartendpoints.
 *
 * Twee lagen, twee databronnen:
 *
 * - /mine leest de eigen bezoeken via de gewone pool.
 * - /public, /heatmap en /venues/:id/reports lezen uitsluitend via publicPool,
 *   dus als de rol kroeg_public. Die rol kan de tabel visits niet lezen. Zelfs
 *   als hier een fout in de query zou zitten kan er geen user_id of tijdstip
 *   uitkomen: de database weigert het.
 *
 * Alle uitvoer van de publieke laag gaat daarnaast nog door de
 * anonimiseringsfuncties, die alleen velden van een witte lijst doorlaten.
 */

/** Bounding-boxfilter dat de GIST-index op location gebruikt. */
const BBOX_FILTER = (from: number) =>
  `location && ST_MakeEnvelope($${from}, $${from + 1}, $${from + 2}, $${from + 3}, 4326)::geography`;

/** Rastermaat voor de heatmap: grover als je verder uitzoomt. */
function heatGridSize(zoom: number): number {
  return Math.max(0.0002, 360 / 2 ** zoom / 4);
}

const mapRoutes: FastifyPluginAsync = async (app) => {
  /** Eigen bezochte tenten in het zichtbare kaartvlak. */
  app.get(
    '/mine',
    { preHandler: app.requireAuth, schema: { querystring: mapBboxQuerySchema } },
    async (request) => {
      const { bbox, limit } = request.query as z.infer<typeof mapBboxQuerySchema>;
      const user = request.currentUser!;

      const rows = await appPool.query<{
        venue_id: string;
        name: string;
        city: string | null;
        lat: number;
        lon: number;
        visit_count: number;
        avg_rating: number;
        last_visited_at: Date;
        last_visit_id: string;
      }>(
        `SELECT ven.id AS venue_id, ven.name, ven.city,
                ST_Y(ven.location::geometry) AS lat,
                ST_X(ven.location::geometry) AS lon,
                count(*)::int AS visit_count,
                avg(v.rating)::float8 AS avg_rating,
                max(v.visited_at) AS last_visited_at,
                (array_agg(v.id ORDER BY v.visited_at DESC))[1] AS last_visit_id
         FROM visits v
         JOIN venues ven ON ven.id = v.venue_id
         WHERE v.user_id = $1 AND ven.${BBOX_FILTER(2)}
         GROUP BY ven.id, ven.name, ven.city, ven.location
         ORDER BY last_visited_at DESC
         LIMIT $6`,
        [user.id, bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, limit],
      );

      const items: MineMapFeature[] = rows.rows.map((r) => ({
        venueId: r.venue_id,
        name: r.name,
        city: r.city,
        lat: Number(r.lat),
        lon: Number(r.lon),
        visitCount: r.visit_count,
        avgRating: Math.round(Number(r.avg_rating) * 100) / 100,
        lastVisitedAt: r.last_visited_at.toISOString(),
        lastVisitId: r.last_visit_id,
      }));
      return { items };
    },
  );

  /**
   * Anoniem gemelde tenten in het zichtbare kaartvlak.
   *
   * De view laat alleen tenten door met drie of meer onafhankelijke melders. Een
   * tent met een of twee meldingen staat hier dus niet op, en dat is opzet: een
   * marker met een enkele melding zou in een dorp naar een persoon leiden.
   */
  app.get(
    '/public',
    { preHandler: app.requireAuth, schema: { querystring: mapBboxQuerySchema } },
    async (request) => {
      const { bbox, limit } = request.query as z.infer<typeof mapBboxQuerySchema>;

      const rows = await publicPool.query(
        `SELECT venue_id, name, city, lat, lon,
                report_count, reporter_count, avg_rating, top_tags,
                first_month, last_month
         FROM public_venue_points
         WHERE ${BBOX_FILTER(1)}
         ORDER BY report_count DESC
         LIMIT $5`,
        [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, limit],
      );

      return { items: toPublicMapFeatures(rows.rows as Array<Record<string, unknown>>) };
    },
  );

  /** In de buurt: tenten binnen een straal, met ST_DWithin. */
  app.get(
    '/nearby',
    { preHandler: app.requireAuth, schema: { querystring: nearbyQuerySchema } },
    async (request) => {
      const q = request.query as z.infer<typeof nearbyQuerySchema>;
      const user = request.currentUser!;

      if (q.layer === 'mine') {
        const rows = await appPool.query<{
          venue_id: string;
          name: string;
          city: string | null;
          lat: number;
          lon: number;
          visit_count: number;
          avg_rating: number;
          last_visited_at: Date;
          last_visit_id: string;
          distance_m: number;
        }>(
          `SELECT ven.id AS venue_id, ven.name, ven.city,
                  ST_Y(ven.location::geometry) AS lat,
                  ST_X(ven.location::geometry) AS lon,
                  count(*)::int AS visit_count,
                  avg(v.rating)::float8 AS avg_rating,
                  max(v.visited_at) AS last_visited_at,
                  (array_agg(v.id ORDER BY v.visited_at DESC))[1] AS last_visit_id,
                  min(ST_Distance(ven.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)) AS distance_m
           FROM visits v
           JOIN venues ven ON ven.id = v.venue_id
           WHERE v.user_id = $1
             AND ST_DWithin(ven.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
           GROUP BY ven.id, ven.name, ven.city, ven.location
           ORDER BY distance_m ASC
           LIMIT $5`,
          [user.id, q.lon, q.lat, q.radius, q.limit],
        );
        return {
          items: rows.rows.map((r) => ({
            venueId: r.venue_id,
            name: r.name,
            city: r.city,
            lat: Number(r.lat),
            lon: Number(r.lon),
            visitCount: r.visit_count,
            avgRating: Math.round(Number(r.avg_rating) * 100) / 100,
            lastVisitedAt: r.last_visited_at.toISOString(),
            lastVisitId: r.last_visit_id,
            distanceM: Math.round(Number(r.distance_m)),
          })),
        };
      }

      const rows = await publicPool.query(
        `SELECT venue_id, name, city, lat, lon,
                report_count, reporter_count, avg_rating, top_tags,
                first_month, last_month,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
         FROM public_venue_points
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY distance_m ASC
         LIMIT $4`,
        [q.lon, q.lat, q.radius, q.limit],
      );

      const distances = new Map(
        (rows.rows as Array<Record<string, unknown>>).map((r) => [
          String(r.venue_id),
          Math.round(Number(r.distance_m)),
        ]),
      );
      // distance_m eruit voordat de anonimisering de rij afkeurt op een onbekend veld.
      const cleaned = (rows.rows as Array<Record<string, unknown>>).map(
        ({ distance_m: _distance, ...rest }) => rest,
      );
      const items = toPublicMapFeatures(cleaned).map((f) => ({
        ...f,
        distanceM: distances.get(f.venueId) ?? null,
      }));
      return { items };
    },
  );

  /**
   * Optionele heatmaplaag op basis van meldingsdichtheid. De punten zijn
   * rastercellen, niet losse tenten, dus dit maakt de anonimiteit niet zwakker
   * dan de puntenlaag zelf.
   */
  app.get(
    '/heatmap',
    { preHandler: app.requireAuth, schema: { querystring: heatmapQuerySchema } },
    async (request) => {
      const { bbox, zoom } = request.query as z.infer<typeof heatmapQuerySchema>;
      const rows = await publicPool.query<{ lat: number; lon: number; weight: number }>(
        `SELECT ST_Y(cell) AS lat, ST_X(cell) AS lon, sum(report_count)::int AS weight
         FROM (
           SELECT ST_SnapToGrid(location::geometry, $5) AS cell, report_count
           FROM public_venue_points
           WHERE ${BBOX_FILTER(1)}
         ) grid
         GROUP BY cell
         ORDER BY weight DESC
         LIMIT 5000`,
        [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, heatGridSize(zoom)],
      );
      const items: HeatPointDto[] = rows.rows.map((r) => ({
        lat: Number(r.lat),
        lon: Number(r.lon),
        weight: r.weight,
      }));
      return { items };
    },
  );

  /** Anonieme meldingsteksten van een tent, voor de popup en het detailpaneel. */
  app.get(
    '/venues/:id/reports',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: venueReportsQuerySchema,
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as z.infer<typeof venueReportsQuerySchema>;

      const rows = await publicPool.query(
        `SELECT report_id, rating, tags, description, visited_month
         FROM public_visit_reports
         WHERE venue_id = $1
         ORDER BY visited_month DESC, report_id
         LIMIT $2`,
        [id, limit],
      );

      return {
        items: (rows.rows as Array<Record<string, unknown>>).map(toPublicReport),
      };
    },
  );

  /** Eigen bezoeken aan een tent, voor het detailpaneel met foto en beschrijving. */
  app.get(
    '/venues/:id/mine',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;
      const ids = await appPool.query<{ id: string }>(
        `SELECT id FROM visits
         WHERE user_id = $1 AND venue_id = $2
         ORDER BY visited_at DESC
         LIMIT 50`,
        [user.id, id],
      );
      const visits = await fetchVisitsByIds(ids.rows.map((r) => r.id));
      return { items: ids.rows.map((r) => visits.get(r.id)).filter(Boolean) };
    },
  );
};

export default mapRoutes;
