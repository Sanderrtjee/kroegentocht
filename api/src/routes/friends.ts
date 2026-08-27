import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { friendRequestSchema, friendRespondSchema } from '@kroegentocht/shared';
import type { FriendDto } from '@kroegentocht/shared';
import { appPool } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/**
 * Vriendschappen bestaan alleen om de zichtbaarheid 'friends' een publiek te
 * geven. Ze zijn wederzijds en moeten geaccepteerd worden; zonder acceptatie kan
 * niemand zichzelf toegang geven tot jouw bezoeken.
 */
const friendRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;
    const rows = await appPool.query<{
      id: string;
      status: string;
      requester_id: string;
      addressee_id: string;
      other_id: string;
      other_username: string;
    }>(
      `SELECT f.id, f.status, f.requester_id, f.addressee_id,
              u.id AS other_id, u.username::text AS other_username
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.requester_id = $1 OR f.addressee_id = $1
       ORDER BY f.status ASC, lower(u.username::text) ASC`,
      [user.id],
    );

    const items: FriendDto[] = rows.rows.map((r) => ({
      friendshipId: r.id,
      userId: r.other_id,
      username: r.other_username,
      status: r.status as 'pending' | 'accepted',
      direction:
        r.status === 'accepted'
          ? 'mutual'
          : r.requester_id === user.id
            ? 'outgoing'
            : 'incoming',
    }));
    return { items };
  });

  app.post(
    '/',
    { preHandler: app.requireAuth, schema: { body: friendRequestSchema } },
    async (request, reply) => {
      const { username } = request.body as { username: string };
      const user = request.currentUser!;

      const target = await appPool.query<{ id: string }>(
        'SELECT id FROM users WHERE username = $1',
        [username],
      );
      const targetId = target.rows[0]?.id;
      if (!targetId) throw notFound('Deze gebruiker bestaat niet.');
      if (targetId === user.id) throw badRequest('Jezelf toevoegen heeft geen zin.');

      const inserted = await appPool.query<{ id: string }>(
        `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)
         ON CONFLICT (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
         DO NOTHING
         RETURNING id`,
        [user.id, targetId],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw conflict('Er is al een verzoek of vriendschap met deze gebruiker.');

      await recordAudit({
        actorUserId: user.id,
        action: 'create',
        entityType: 'friendship',
        entityId: id,
      });
      return reply.status(201).send({ friendshipId: id, status: 'pending' });
    },
  );

  app.post(
    '/:id/respond',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: friendRespondSchema },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { accept } = request.body as { accept: boolean };
      const user = request.currentUser!;

      // Alleen de ontvanger van het verzoek kan het accepteren.
      if (accept) {
        const updated = await appPool.query(
          `UPDATE friendships SET status = 'accepted', accepted_at = now()
           WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
           RETURNING id`,
          [id, user.id],
        );
        if (updated.rowCount === 0) throw notFound('Dit verzoek staat niet open voor jou.');
        await recordAudit({
          actorUserId: user.id,
          action: 'update',
          entityType: 'friendship',
          entityId: id,
        });
        return { friendshipId: id, status: 'accepted' };
      }

      const deleted = await appPool.query(
        'DELETE FROM friendships WHERE id = $1 AND addressee_id = $2 RETURNING id',
        [id, user.id],
      );
      if (deleted.rowCount === 0) throw notFound('Dit verzoek staat niet open voor jou.');
      await recordAudit({
        actorUserId: user.id,
        action: 'delete',
        entityType: 'friendship',
        entityId: id,
      });
      return reply.status(204).send();
    },
  );

  app.delete(
    '/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;
      const deleted = await appPool.query(
        `DELETE FROM friendships
         WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
         RETURNING id`,
        [id, user.id],
      );
      if (deleted.rowCount === 0) throw notFound('Deze vriendschap bestaat niet.');
      await recordAudit({
        actorUserId: user.id,
        action: 'delete',
        entityType: 'friendship',
        entityId: id,
      });
      return reply.status(204).send();
    },
  );
};

export default friendRoutes;
