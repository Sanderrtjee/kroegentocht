import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { personCreateSchema, personUpdateSchema } from '@kroegentocht/shared';
import type { PersonDto } from '@kroegentocht/shared';
import { appPool } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';

/**
 * De eigen maatjeslijst. Dit zijn geen accounts en ze zijn niet zichtbaar voor
 * anderen: het zijn labels van deze gebruiker, bedoeld om aanwezigen te kunnen
 * hergebruiken. Namen van derden zijn wel persoonsgegevens, dus ze staan alleen
 * bij de gebruiker die ze invoerde en verdwijnen mee als die zijn account wist.
 */
const peopleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;
    const rows = await appPool.query<{ id: string; name: string; visit_count: number }>(
      `SELECT p.id, p.name, count(a.visit_id)::int AS visit_count
       FROM people p
       LEFT JOIN visit_attendees a ON a.person_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id, p.name
       ORDER BY visit_count DESC, lower(p.name) ASC`,
      [user.id],
    );
    const items: PersonDto[] = rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      visitCount: r.visit_count,
    }));
    return { items };
  });

  app.post(
    '/',
    { preHandler: app.requireAuth, schema: { body: personCreateSchema } },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const user = request.currentUser!;

      const inserted = await appPool.query<{ id: string; name: string }>(
        `INSERT INTO people (user_id, name) VALUES ($1, $2)
         ON CONFLICT (user_id, lower(name)) DO NOTHING
         RETURNING id, name`,
        [user.id, name.trim()],
      );

      const row = inserted.rows[0];
      if (!row) throw conflict('Deze naam staat al in je lijst.');

      await recordAudit({
        actorUserId: user.id,
        action: 'create',
        entityType: 'person',
        entityId: row.id,
      });

      const body: PersonDto = { id: row.id, name: row.name, visitCount: 0 };
      return reply.status(201).send(body);
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: personUpdateSchema },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: string };
      const user = request.currentUser!;

      const updated = await appPool.query<{ id: string; name: string }>(
        'UPDATE people SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name',
        [name.trim(), id, user.id],
      );
      const row = updated.rows[0];
      if (!row) throw notFound('Deze persoon staat niet in je lijst.');

      await recordAudit({
        actorUserId: user.id,
        action: 'update',
        entityType: 'person',
        entityId: id,
      });
      return { id: row.id, name: row.name };
    },
  );

  app.delete(
    '/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;

      const deleted = await appPool.query(
        'DELETE FROM people WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, user.id],
      );
      if (deleted.rowCount === 0) throw notFound('Deze persoon staat niet in je lijst.');

      await recordAudit({
        actorUserId: user.id,
        action: 'delete',
        entityType: 'person',
        entityId: id,
      });
      return reply.status(204).send();
    },
  );
};

export default peopleRoutes;
