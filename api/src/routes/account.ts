import type { FastifyPluginAsync } from 'fastify';
import { changePasswordSchema, deleteAccountSchema } from '@kroegentocht/shared';
import { appPool, withTransaction } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { SESSION_COOKIE, destroyAllSessionsForUser } from '../lib/session.js';
import { deleteMediaFile } from '../lib/storage.js';

/**
 * Eigen account: wachtwoord wijzigen en volledig verwijderen.
 *
 * Verwijderen is echt verwijderen. Er blijft geen gemarkeerde rij achter en er
 * blijft geen anonieme melding achter: die zijn rijen in visits en gaan dus mee.
 * De aggregaten op de kaart zakken daardoor terug, en een tent die daarmee onder
 * de drempel van drie melders komt verdwijnt van de publieke laag. Dat is de
 * bedoeling, niet een bijwerking.
 *
 * Wat blijft staan:
 * - venues, want een kroeg is geen persoonsgegeven; created_by wordt NULL
 * - regels in audit_log, met actor_user_id op NULL
 * De bewaartermijnen staan in de README.
 */
const accountRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/password',
    { preHandler: app.requireAuth, schema: { body: changePasswordSchema } },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body as {
        currentPassword: string;
        newPassword: string;
      };
      const user = request.currentUser!;

      const found = await appPool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
      );
      const hash = found.rows[0]?.password_hash;
      if (!hash) throw unauthorized();

      if (!(await verifyPassword(hash, currentPassword))) {
        throw unauthorized('Het huidige wachtwoord is onjuist.');
      }
      if (currentPassword === newPassword) {
        throw badRequest('Het nieuwe wachtwoord moet anders zijn.');
      }

      await appPool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
        await hashPassword(newPassword),
        user.id,
      ]);

      // Alle sessies eruit, ook de huidige: een wachtwoordwijziging hoort een
      // gestolen sessie ongeldig te maken.
      await destroyAllSessionsForUser(user.id);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });

      await recordAudit({
        actorUserId: user.id,
        action: 'update',
        entityType: 'user',
        entityId: user.id,
        details: { passwordChanged: true },
      });

      return { ok: true, reloginRequired: true };
    },
  );

  app.delete(
    '/',
    { preHandler: app.requireAuth, schema: { body: deleteAccountSchema } },
    async (request, reply) => {
      const { confirmUsername, password } = request.body as {
        confirmUsername: string;
        password: string;
      };
      const user = request.currentUser!;

      if (confirmUsername.toLowerCase() !== user.username.toLowerCase()) {
        throw badRequest('De ingevoerde gebruikersnaam klopt niet.');
      }

      const found = await appPool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
      );
      const hash = found.rows[0]?.password_hash;
      if (!hash || !(await verifyPassword(hash, password))) {
        throw unauthorized('Wachtwoord is onjuist.');
      }

      const paths = await withTransaction(async (client) => {
        const photos = await client.query<{ storage_path: string; thumb_path: string }>(
          `SELECT p.storage_path, p.thumb_path
           FROM visit_photos p JOIN visits v ON v.id = p.visit_id
           WHERE v.user_id = $1`,
          [user.id],
        );

        // Audit eerst, zolang de gebruiker nog bestaat. Bij het verwijderen zet
        // de foreign key actor_user_id op NULL, dus de regel blijft leesbaar
        // zonder naar een verdwenen account te wijzen.
        await recordAudit(
          {
            actorUserId: user.id,
            action: 'delete',
            entityType: 'user',
            entityId: user.id,
            details: { photos: photos.rowCount ?? 0 },
          },
          client,
        );

        // visits, visit_photos, visit_attendees, people, crawls, crawl_stops,
        // sessions en friendships hangen allemaal aan een cascade op user_id.
        await client.query('DELETE FROM users WHERE id = $1', [user.id]);

        return photos.rows;
      });

      for (const p of paths) {
        await deleteMediaFile(p.storage_path);
        await deleteMediaFile(p.thumb_path);
      }

      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(200).send({ deleted: true, photosRemoved: paths.length });
    },
  );
};

export default accountRoutes;
