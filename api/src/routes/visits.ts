import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import {
  visitCreateSchema,
  visitListQuerySchema,
  visitUpdateSchema,
} from '@kroegentocht/shared';
import type { Paged, VisitDto } from '@kroegentocht/shared';
import { appPool, withTransaction } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { appendCrawlStop, recomputeCrawl } from '../lib/crawl-utils.js';
import { badRequest, notFound } from '../lib/errors.js';
import { canViewVisit } from '../lib/friends.js';
import { deleteMediaFile } from '../lib/storage.js';
import { fetchVisitById, fetchVisitList } from '../lib/visit-queries.js';
import { resolveVenue } from './venues.js';

type AttendeeInput = { personId?: string; name?: string; remember: boolean };

/**
 * Zet de lijst aanwezigen van een bezoek gelijk aan wat er is meegegeven.
 *
 * Een naam die nog niet in de eigen maatjeslijst staat komt daar bij te staan,
 * tenzij remember op false staat. Dat is precies waarom de tabel people bestaat:
 * de tweede keer klik je Bram aan in plaats van hem opnieuw te typen. Alleen
 * eenmalige gasten belanden als vrije tekst in visit_attendees.
 */
async function syncAttendees(
  client: pg.PoolClient,
  userId: string,
  visitId: string,
  attendees: readonly AttendeeInput[],
): Promise<void> {
  await client.query('DELETE FROM visit_attendees WHERE visit_id = $1', [visitId]);

  const seenPersonIds = new Set<string>();

  for (const attendee of attendees) {
    let personId: string | null = null;
    let freeName: string | null = null;

    if (attendee.personId) {
      const owned = await client.query('SELECT 1 FROM people WHERE id = $1 AND user_id = $2', [
        attendee.personId,
        userId,
      ]);
      if ((owned.rowCount ?? 0) === 0) {
        throw badRequest('Onbekende persoon in de lijst aanwezigen.');
      }
      personId = attendee.personId;
    } else if (attendee.name) {
      const name = attendee.name.trim();
      if (name.length === 0) continue;

      if (attendee.remember) {
        const upserted = await client.query<{ id: string }>(
          `INSERT INTO people (user_id, name) VALUES ($1, $2)
           ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = people.name
           RETURNING id`,
          [userId, name],
        );
        personId = upserted.rows[0]?.id ?? null;
      } else {
        freeName = name;
      }
    }

    if (personId) {
      // Dezelfde persoon twee keer in een bezoek heeft geen betekenis.
      if (seenPersonIds.has(personId)) continue;
      seenPersonIds.add(personId);
    }

    await client.query(
      'INSERT INTO visit_attendees (visit_id, person_id, free_name) VALUES ($1, $2, $3)',
      [visitId, personId, freeName],
    );
  }
}

async function assertOwnCrawl(
  client: pg.PoolClient,
  userId: string,
  crawlId: string,
): Promise<void> {
  const owned = await client.query('SELECT 1 FROM crawls WHERE id = $1 AND user_id = $2', [
    crawlId,
    userId,
  ]);
  if ((owned.rowCount ?? 0) === 0) throw notFound('Deze tocht bestaat niet.');
}

const visitRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Bezoek vastleggen.
   *
   * Idempotent op verzoek van de offline wachtrij: de frontend genereert een
   * idempotencyKey per bezoek en stuurt die bij elke poging opnieuw mee. Komt
   * hetzelfde bezoek een tweede keer binnen, bijvoorbeeld omdat de eerste
   * poging het antwoord niet meer haalde, dan krijgt de client het bestaande
   * bezoek terug in plaats van een duplicaat.
   */
  app.post(
    '/',
    { preHandler: app.requireAuth, schema: { body: visitCreateSchema } },
    async (request, reply) => {
      const body = request.body as z.infer<typeof visitCreateSchema>;
      const user = request.currentUser!;

      if (body.idempotencyKey) {
        const existing = await appPool.query<{ id: string }>(
          'SELECT id FROM visits WHERE user_id = $1 AND idempotency_key = $2',
          [user.id, body.idempotencyKey],
        );
        const existingId = existing.rows[0]?.id;
        if (existingId) {
          const loaded = await fetchVisitById(existingId);
          if (loaded) return reply.status(200).send(loaded.visit);
        }
      }

      // Venue eerst, in zijn eigen transactie met zijn eigen advisory lock. Dat
      // houdt de lock kort: hij dekt alleen het aanmaken van de tent en niet ook
      // het schrijven van fotos of aanwezigen.
      const venueId = body.venueId
        ? await (async () => {
            const found = await appPool.query('SELECT 1 FROM venues WHERE id = $1', [body.venueId]);
            if ((found.rowCount ?? 0) === 0) throw badRequest('Onbekende tent.');
            return body.venueId!;
          })()
        : (await resolveVenue(body.venue!, user.id)).venue.id;

      const visitId = await withTransaction(async (client) => {
        if (body.crawlId) await assertOwnCrawl(client, user.id, body.crawlId);

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO visits
             (user_id, venue_id, visited_at, description, rating, price_indication,
              tags, visibility, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9)
           RETURNING id`,
          [
            user.id,
            venueId,
            body.visitedAt,
            body.description,
            body.rating,
            body.priceIndication ?? null,
            body.tags,
            body.visibility,
            body.idempotencyKey ?? null,
          ],
        );
        const id = inserted.rows[0]!.id;

        await syncAttendees(client, user.id, id, body.attendees as AttendeeInput[]);
        if (body.crawlId) await appendCrawlStop(client, body.crawlId, id);

        await recordAudit(
          {
            actorUserId: user.id,
            action: 'create',
            entityType: 'visit',
            entityId: id,
            details: { venueId, visibility: body.visibility, rating: body.rating },
          },
          client,
        );

        return id;
      });

      const loaded = await fetchVisitById(visitId);
      if (!loaded) throw notFound('Bezoek is niet terug te vinden na aanmaken.');
      return reply.status(201).send(loaded.visit);
    },
  );

  app.get(
    '/',
    { preHandler: app.requireAuth, schema: { querystring: visitListQuerySchema } },
    async (request) => {
      const query = request.query as z.infer<typeof visitListQuerySchema>;
      const user = request.currentUser!;
      const { items, total } = await fetchVisitList(user.id, query);
      const body: Paged<VisitDto> = {
        items,
        page: query.page,
        limit: query.limit,
        total,
      };
      return body;
    },
  );

  app.get(
    '/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;
      const loaded = await fetchVisitById(id);
      if (!loaded) throw notFound('Dit bezoek bestaat niet.');

      const allowed = await canViewVisit(user.id, loaded.ownerId, loaded.visit.visibility);
      // Geen onderscheid tussen "bestaat niet" en "mag je niet zien": anders is
      // uit de statuscode af te leiden welke bezoeken er zijn.
      if (!allowed) throw notFound('Dit bezoek bestaat niet.');

      return loaded.visit;
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: visitUpdateSchema },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof visitUpdateSchema>;
      const user = request.currentUser!;

      await withTransaction(async (client) => {
        const owned = await client.query<{ user_id: string }>(
          'SELECT user_id FROM visits WHERE id = $1 FOR UPDATE',
          [id],
        );
        const row = owned.rows[0];
        if (!row) throw notFound('Dit bezoek bestaat niet.');
        if (row.user_id !== user.id) throw notFound('Dit bezoek bestaat niet.');

        const sets: string[] = [];
        const params: unknown[] = [];
        const push = (fragment: string, value: unknown) => {
          params.push(value);
          sets.push(`${fragment} $${params.length}`);
        };

        if (body.visitedAt !== undefined) push('visited_at =', body.visitedAt);
        if (body.description !== undefined) push('description =', body.description);
        if (body.rating !== undefined) push('rating =', body.rating);
        if (body.priceIndication !== undefined) {
          push('price_indication =', body.priceIndication ?? null);
        }
        if (body.tags !== undefined) {
          params.push(body.tags);
          sets.push(`tags = $${params.length}::text[]`);
        }
        if (body.visibility !== undefined) push('visibility =', body.visibility);

        if (sets.length > 0) {
          params.push(id);
          await client.query(
            `UPDATE visits SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
            params,
          );
        }

        if (body.attendees !== undefined) {
          await syncAttendees(client, user.id, id, body.attendees as AttendeeInput[]);
        }

        // Een gewijzigde datum kan de volgorde binnen een tocht veranderen.
        const stop = await client.query<{ crawl_id: string }>(
          'SELECT crawl_id FROM crawl_stops WHERE visit_id = $1',
          [id],
        );
        const crawlId = stop.rows[0]?.crawl_id;
        if (crawlId) await recomputeCrawl(client, crawlId);

        await recordAudit(
          {
            actorUserId: user.id,
            action: 'update',
            entityType: 'visit',
            entityId: id,
            details: { fields: Object.keys(body) },
          },
          client,
        );
      });

      const loaded = await fetchVisitById(id);
      if (!loaded) throw notFound('Dit bezoek bestaat niet.');
      return loaded.visit;
    },
  );

  app.delete(
    '/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;

      const { paths } = await withTransaction(async (client) => {
        const owned = await client.query<{ user_id: string }>(
          'SELECT user_id FROM visits WHERE id = $1 FOR UPDATE',
          [id],
        );
        const row = owned.rows[0];
        if (!row) throw notFound('Dit bezoek bestaat niet.');
        if (row.user_id !== user.id) throw notFound('Dit bezoek bestaat niet.');

        const photos = await client.query<{ storage_path: string; thumb_path: string }>(
          'SELECT storage_path, thumb_path FROM visit_photos WHERE visit_id = $1',
          [id],
        );
        const stop = await client.query<{ crawl_id: string }>(
          'SELECT crawl_id FROM crawl_stops WHERE visit_id = $1',
          [id],
        );

        // visit_photos, visit_attendees en crawl_stops hangen aan een cascade.
        await client.query('DELETE FROM visits WHERE id = $1', [id]);

        const crawlId = stop.rows[0]?.crawl_id;
        if (crawlId) await recomputeCrawl(client, crawlId);

        await recordAudit(
          { actorUserId: user.id, action: 'delete', entityType: 'visit', entityId: id },
          client,
        );

        return { paths: photos.rows };
      });

      // Bestanden pas weggooien nadat de transactie geslaagd is. Andersom zou een
      // teruggedraaide transactie een bezoek zonder fotobestanden achterlaten.
      for (const p of paths) {
        await deleteMediaFile(p.storage_path);
        await deleteMediaFile(p.thumb_path);
      }

      return reply.status(204).send();
    },
  );

  /** Losse steden en tags van de gebruiker, voor de filterbalk. */
  app.get('/filters/options', { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;
    const cities = await appPool.query<{ city: string; n: number }>(
      `SELECT ven.city AS city, count(*)::int AS n
       FROM visits v JOIN venues ven ON ven.id = v.venue_id
       WHERE v.user_id = $1 AND ven.city IS NOT NULL
       GROUP BY ven.city ORDER BY n DESC, ven.city ASC LIMIT 100`,
      [user.id],
    );
    const tags = await appPool.query<{ tag: string; n: number }>(
      `SELECT t.tag AS tag, count(*)::int AS n
       FROM visits v CROSS JOIN LATERAL unnest(v.tags) AS t(tag)
       WHERE v.user_id = $1
       GROUP BY t.tag ORDER BY n DESC, t.tag ASC LIMIT 100`,
      [user.id],
    );
    return {
      cities: cities.rows.map((r) => ({ city: r.city, count: r.n })),
      tags: tags.rows.map((r) => ({ tag: r.tag, count: r.n })),
    };
  });
};

export default visitRoutes;
