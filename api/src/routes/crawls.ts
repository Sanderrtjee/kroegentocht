import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { crawlCreateSchema, crawlStopsSchema, crawlUpdateSchema } from '@kroegentocht/shared';
import type { CrawlDetailDto, CrawlDto, CrawlStopDto } from '@kroegentocht/shared';
import { appPool, withTransaction } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { recomputeCrawl } from '../lib/crawl-utils.js';
import { badRequest, notFound } from '../lib/errors.js';
import { fetchVisitsByIds } from '../lib/visit-queries.js';

const CRAWL_SUMMARY = `
  SELECT c.id, c.name, c.crawl_date, c.notes,
         count(cs.id)::int                                   AS stop_count,
         COALESCE(sum(cs.distance_from_prev_m), 0)::float8    AS total_distance_m,
         avg(v.rating)::float8                                AS average_rating
  FROM crawls c
  LEFT JOIN crawl_stops cs ON cs.crawl_id = c.id
  LEFT JOIN visits v ON v.id = cs.visit_id
`;

interface CrawlSummaryRow {
  id: string;
  name: string;
  crawl_date: string;
  notes: string;
  stop_count: number;
  total_distance_m: number;
  average_rating: number | null;
}

function toCrawlDto(row: CrawlSummaryRow): CrawlDto {
  return {
    id: row.id,
    name: row.name,
    crawlDate: typeof row.crawl_date === 'string' ? row.crawl_date : String(row.crawl_date),
    notes: row.notes,
    stopCount: row.stop_count,
    totalDistanceM: Math.round(row.total_distance_m),
    averageRating:
      row.average_rating === null ? null : Math.round(row.average_rating * 100) / 100,
  };
}

const crawlRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;
    const rows = await appPool.query<CrawlSummaryRow>(
      `${CRAWL_SUMMARY}
       WHERE c.user_id = $1
       GROUP BY c.id, c.name, c.crawl_date, c.notes
       ORDER BY c.crawl_date DESC, c.created_at DESC`,
      [user.id],
    );
    return { items: rows.rows.map(toCrawlDto) };
  });

  app.post(
    '/',
    { preHandler: app.requireAuth, schema: { body: crawlCreateSchema } },
    async (request, reply) => {
      const body = request.body as z.infer<typeof crawlCreateSchema>;
      const user = request.currentUser!;
      const inserted = await appPool.query<{ id: string }>(
        'INSERT INTO crawls (user_id, name, crawl_date, notes) VALUES ($1, $2, $3, $4) RETURNING id',
        [user.id, body.name.trim(), body.crawlDate, body.notes],
      );
      const id = inserted.rows[0]!.id;
      await recordAudit({
        actorUserId: user.id,
        action: 'create',
        entityType: 'crawl',
        entityId: id,
        details: { name: body.name },
      });
      return reply.status(201).send({
        id,
        name: body.name.trim(),
        crawlDate: body.crawlDate,
        notes: body.notes,
        stopCount: 0,
        totalDistanceM: 0,
        averageRating: null,
      } satisfies CrawlDto);
    },
  );

  /**
   * Tochtweergave: de chronologische tijdlijn van de avond, met per stop de
   * afstand tot de vorige tent, en daarnaast het gemiddelde en de totale afstand.
   */
  app.get(
    '/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;

      const summary = await appPool.query<CrawlSummaryRow>(
        `${CRAWL_SUMMARY}
         WHERE c.id = $1 AND c.user_id = $2
         GROUP BY c.id, c.name, c.crawl_date, c.notes`,
        [id, user.id],
      );
      const summaryRow = summary.rows[0];
      if (!summaryRow) throw notFound('Deze tocht bestaat niet.');

      const stopRows = await appPool.query<{
        visit_id: string;
        position: number;
        distance_from_prev_m: number | null;
      }>(
        `SELECT visit_id, position, distance_from_prev_m
         FROM crawl_stops WHERE crawl_id = $1 ORDER BY position ASC`,
        [id],
      );

      const visits = await fetchVisitsByIds(stopRows.rows.map((r) => r.visit_id));
      const stops: CrawlStopDto[] = [];
      for (const row of stopRows.rows) {
        const visit = visits.get(row.visit_id);
        if (!visit) continue;
        stops.push({
          position: row.position,
          distanceFromPrevM:
            row.distance_from_prev_m === null ? null : Math.round(row.distance_from_prev_m),
          visit,
        });
      }

      // Iedereen die die avond ergens bij was, een keer.
      const attendees = [
        ...new Set(stops.flatMap((s) => s.visit.attendees.map((a) => a.name))),
      ].sort((a, b) => a.localeCompare(b, 'nl'));

      const body: CrawlDetailDto = { ...toCrawlDto(summaryRow), stops, attendees };
      return body;
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: crawlUpdateSchema },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof crawlUpdateSchema>;
      const user = request.currentUser!;

      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.name !== undefined) {
        params.push(body.name.trim());
        sets.push(`name = $${params.length}`);
      }
      if (body.crawlDate !== undefined) {
        params.push(body.crawlDate);
        sets.push(`crawl_date = $${params.length}`);
      }
      if (body.notes !== undefined) {
        params.push(body.notes);
        sets.push(`notes = $${params.length}`);
      }
      if (sets.length === 0) throw badRequest('Niets om te wijzigen.');

      params.push(id, user.id);
      const updated = await appPool.query(
        `UPDATE crawls SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.length - 1} AND user_id = $${params.length}
         RETURNING id`,
        params,
      );
      if (updated.rowCount === 0) throw notFound('Deze tocht bestaat niet.');

      await recordAudit({
        actorUserId: user.id,
        action: 'update',
        entityType: 'crawl',
        entityId: id,
        details: { fields: Object.keys(body) },
      });
      return { ok: true };
    },
  );

  /**
   * Zet de volledige, geordende lijst stops. De afstanden worden daarna serverside
   * herrekend, zodat de client geen afstanden kan verzinnen.
   */
  app.put(
    '/:id/stops',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: crawlStopsSchema },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { visitIds } = request.body as { visitIds: string[] };
      const user = request.currentUser!;

      if (new Set(visitIds).size !== visitIds.length) {
        throw badRequest('Een bezoek kan maar een keer in een tocht staan.');
      }

      await withTransaction(async (client) => {
        const owned = await client.query('SELECT 1 FROM crawls WHERE id = $1 AND user_id = $2', [
          id,
          user.id,
        ]);
        if ((owned.rowCount ?? 0) === 0) throw notFound('Deze tocht bestaat niet.');

        if (visitIds.length > 0) {
          const check = await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM visits WHERE id = ANY($1::uuid[]) AND user_id = $2',
            [visitIds, user.id],
          );
          if ((check.rows[0]?.n ?? 0) !== visitIds.length) {
            throw badRequest('Een of meer bezoeken bestaan niet of zijn niet van jou.');
          }
        }

        await client.query('DELETE FROM crawl_stops WHERE crawl_id = $1', [id]);
        // Ook stops in andere tochten van deze bezoeken opheffen: een bezoek
        // hoort bij hoogstens een tocht.
        if (visitIds.length > 0) {
          await client.query('DELETE FROM crawl_stops WHERE visit_id = ANY($1::uuid[])', [
            visitIds,
          ]);
          await client.query(
            `INSERT INTO crawl_stops (crawl_id, visit_id, position)
             SELECT $1, x.visit_id, x.position - 1
             FROM unnest($2::uuid[]) WITH ORDINALITY AS x(visit_id, position)`,
            [id, visitIds],
          );
        }

        await recomputeCrawl(client, id);
        await recordAudit(
          {
            actorUserId: user.id,
            action: 'update',
            entityType: 'crawl',
            entityId: id,
            details: { stops: visitIds.length },
          },
          client,
        );
      });

      return { ok: true, stops: visitIds.length };
    },
  );

  app.delete(
    '/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;
      // crawl_stops hangt aan een cascade; de bezoeken zelf blijven bestaan.
      const deleted = await appPool.query(
        'DELETE FROM crawls WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, user.id],
      );
      if (deleted.rowCount === 0) throw notFound('Deze tocht bestaat niet.');
      await recordAudit({
        actorUserId: user.id,
        action: 'delete',
        entityType: 'crawl',
        entityId: id,
      });
      return reply.status(204).send();
    },
  );
};

export default crawlRoutes;
