import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { contentReportCreateSchema, moderationActionSchema } from '@kroegentocht/shared';
import type { ModerationItemDto } from '@kroegentocht/shared';
import { appPool, publicPool, withTransaction } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';

/**
 * Melden en verbergen van ongepaste anonieme teksten.
 *
 * Een moderator ziet de tekst en de tent, en niet wie de melding schreef. Dat is
 * geen luxe maar de kern van de anonieme laag: als een moderator de auteur kan
 * opzoeken is de anonimiteit weg. De wachtrij haalt daarom bewust geen user_id
 * op, ook niet als moderator.
 */
const moderationRoutes: FastifyPluginAsync = async (app) => {
  /** Meldknop, voor iedere ingelogde gebruiker. */
  app.post(
    '/reports',
    { preHandler: app.requireAuth, schema: { body: contentReportCreateSchema } },
    async (request, reply) => {
      const { reportId, reason } = request.body as { reportId: string; reason: string };
      const user = request.currentUser!;

      // Alleen iets dat daadwerkelijk publiek zichtbaar is kan gemeld worden.
      // De check gaat via de read-only pool, dus via dezelfde view die de
      // gebruiker te zien kreeg.
      const visible = await publicPool.query(
        'SELECT 1 FROM public_visit_reports WHERE report_id = $1',
        [reportId],
      );
      if ((visible.rowCount ?? 0) === 0) throw notFound('Deze melding bestaat niet.');

      const inserted = await appPool.query<{ id: string }>(
        `INSERT INTO content_reports (visit_id, reporter_user_id, reason)
         VALUES ($1, $2, $3) RETURNING id`,
        [reportId, user.id, reason],
      );
      const id = inserted.rows[0]!.id;

      await recordAudit({
        actorUserId: user.id,
        action: 'create',
        entityType: 'content_report',
        entityId: id,
      });

      return reply.status(201).send({ contentReportId: id, status: 'open' });
    },
  );

  app.get(
    '/queue',
    {
      preHandler: app.requireRole('moderator', 'admin'),
      schema: {
        querystring: z.object({
          status: z.enum(['open', 'hidden', 'dismissed', 'all']).default('open'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) => {
      const { status, limit } = request.query as { status: string; limit: number };

      const rows = await appPool.query<{
        content_report_id: string;
        report_id: string;
        reason: string;
        status: string;
        created_at: Date;
        venue_name: string;
        description: string;
        moderation_hidden: boolean;
      }>(
        `SELECT cr.id AS content_report_id,
                cr.visit_id AS report_id,
                cr.reason,
                cr.status,
                cr.created_at,
                ven.name AS venue_name,
                v.description,
                v.moderation_hidden
         FROM content_reports cr
         JOIN visits v ON v.id = cr.visit_id
         JOIN venues ven ON ven.id = v.venue_id
         WHERE ($1 = 'all' OR cr.status = $1)
         ORDER BY cr.created_at DESC
         LIMIT $2`,
        [status, limit],
      );

      const items: ModerationItemDto[] = rows.rows.map((r) => ({
        reportId: r.report_id,
        contentReportId: r.content_report_id,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        venueName: r.venue_name,
        description: r.description,
        hidden: r.moderation_hidden,
      }));
      return { items };
    },
  );

  app.post(
    '/reports/:id/action',
    {
      preHandler: app.requireRole('moderator', 'admin'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: moderationActionSchema,
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { action } = request.body as z.infer<typeof moderationActionSchema>;
      const moderator = request.currentUser!;

      await withTransaction(async (client) => {
        const found = await client.query<{ visit_id: string }>(
          'SELECT visit_id FROM content_reports WHERE id = $1 FOR UPDATE',
          [id],
        );
        const visitId = found.rows[0]?.visit_id;
        if (!visitId) throw notFound('Deze melding bestaat niet.');

        if (action === 'hide' || action === 'unhide') {
          const hidden = action === 'hide';
          await client.query(
            `UPDATE visits
             SET moderation_hidden = $1, moderated_by = $2, moderated_at = now()
             WHERE id = $3`,
            [hidden, moderator.id, visitId],
          );
          await client.query(
            'UPDATE content_reports SET status = $1, handled_by = $2, handled_at = now() WHERE id = $3',
            [hidden ? 'hidden' : 'open', moderator.id, id],
          );
        } else {
          await client.query(
            `UPDATE content_reports SET status = 'dismissed', handled_by = $1, handled_at = now()
             WHERE id = $2`,
            [moderator.id, id],
          );
        }

        await recordAudit(
          {
            actorUserId: moderator.id,
            action: 'update',
            entityType: 'content_report',
            entityId: id,
            details: { moderationAction: action, visitId },
          },
          client,
        );
      });

      return { ok: true, action };
    },
  );
};

export default moderationRoutes;
