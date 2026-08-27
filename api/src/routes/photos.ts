import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MAX_PHOTOS_PER_VISIT, photoSizeQuerySchema } from '@kroegentocht/shared';
import type { PhotoDto } from '@kroegentocht/shared';
import { appPool, withTransaction } from '../db/client.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound, payloadTooLarge } from '../lib/errors.js';
import { canViewVisit } from '../lib/friends.js';
import { processUpload } from '../lib/images.js';
import {
  deleteMediaFile,
  mediaFileStats,
  mediaReadStream,
  newPhotoPaths,
  writeMediaFile,
} from '../lib/storage.js';
import { photoUrl } from '../lib/visit-queries.js';
import { uploadRateLimit } from '../plugins/security.js';

/**
 * Fotos worden nooit als statische map uitgeserveerd.
 *
 * De bestanden staan onder MEDIA_ROOT, buiten de webroot, met een gegenereerde
 * uuid als naam. Elk verzoek om een foto gaat door dit endpoint, dat eerst
 * ophaalt bij welk bezoek de foto hoort en dan of de kijker dat bezoek mag zien.
 * Het raden van een uuid levert dus nog geen foto op.
 */
const photoRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/visits/:visitId/photos',
    {
      preHandler: app.requireAuth,
      config: uploadRateLimit,
      schema: { params: z.object({ visitId: z.string().uuid() }) },
    },
    async (request, reply) => {
      const { visitId } = request.params as { visitId: string };
      const user = request.currentUser!;

      const owned = await appPool.query<{ user_id: string }>(
        'SELECT user_id FROM visits WHERE id = $1',
        [visitId],
      );
      if (owned.rows[0]?.user_id !== user.id) throw notFound('Dit bezoek bestaat niet.');

      if (!request.isMultipart()) {
        throw badRequest('Verwacht een multipart/form-data verzoek met bestanden.');
      }

      const existing = await appPool.query<{ n: number; max_position: number | null }>(
        'SELECT count(*)::int AS n, max(position) AS max_position FROM visit_photos WHERE visit_id = $1',
        [visitId],
      );
      let count = existing.rows[0]?.n ?? 0;
      let nextPosition = (existing.rows[0]?.max_position ?? -1) + 1;

      const created: PhotoDto[] = [];

      for await (const part of request.files()) {
        if (count >= MAX_PHOTOS_PER_VISIT) {
          throw badRequest(`Maximaal ${MAX_PHOTOS_PER_VISIT} fotos per bezoek.`);
        }

        const buffer = await part.toBuffer();
        if (part.file.truncated) {
          throw payloadTooLarge('Bestand is te groot.');
        }

        request.log.info(
          { claimedMimetype: part.mimetype, bytes: buffer.length },
          'upload ontvangen, formaat wordt op magic bytes bepaald',
        );

        // Hier zit de EXIF-strip en de hercodering naar webp.
        const processed = await processUpload(buffer);

        // Dezelfde foto twee keer bij hetzelfde bezoek levert een keer een rij op.
        const duplicate = await appPool.query<{ id: string; width: number; height: number; position: number }>(
          'SELECT id, width, height, position FROM visit_photos WHERE visit_id = $1 AND content_hash = $2',
          [visitId, processed.contentHash],
        );
        const duplicateRow = duplicate.rows[0];
        if (duplicateRow) {
          created.push({
            id: duplicateRow.id,
            width: duplicateRow.width,
            height: duplicateRow.height,
            position: duplicateRow.position,
            thumbUrl: photoUrl(duplicateRow.id, 'thumb'),
            fullUrl: photoUrl(duplicateRow.id, 'full'),
          });
          continue;
        }

        const paths = newPhotoPaths();
        await writeMediaFile(paths.storagePath, processed.full.buffer);
        await writeMediaFile(paths.thumbPath, processed.thumb.buffer);

        try {
          const inserted = await withTransaction(async (client) => {
            const row = await client.query<{ id: string }>(
              `INSERT INTO visit_photos
                 (visit_id, storage_path, thumb_path, width, height, byte_size, content_hash, position)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id`,
              [
                visitId,
                paths.storagePath,
                paths.thumbPath,
                processed.full.width,
                processed.full.height,
                processed.full.buffer.length,
                processed.contentHash,
                nextPosition,
              ],
            );
            const id = row.rows[0]!.id;
            await recordAudit(
              {
                actorUserId: user.id,
                action: 'create',
                entityType: 'visit_photo',
                entityId: id,
                details: { visitId, bytes: processed.full.buffer.length },
              },
              client,
            );
            return id;
          });

          created.push({
            id: inserted,
            width: processed.full.width,
            height: processed.full.height,
            position: nextPosition,
            thumbUrl: photoUrl(inserted, 'thumb'),
            fullUrl: photoUrl(inserted, 'full'),
          });
          count += 1;
          nextPosition += 1;
        } catch (err) {
          // Geen rij, dan ook geen bestanden laten slingeren.
          await deleteMediaFile(paths.storagePath);
          await deleteMediaFile(paths.thumbPath);
          throw err;
        }
      }

      if (created.length === 0) throw badRequest('Geen bestanden ontvangen.');
      return reply.status(201).send({ items: created });
    },
  );

  app.get(
    '/photos/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: photoSizeQuerySchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { size } = request.query as z.infer<typeof photoSizeQuerySchema>;
      const user = request.currentUser!;

      const found = await appPool.query<{
        storage_path: string;
        thumb_path: string;
        owner_id: string;
        visibility: string;
      }>(
        `SELECT p.storage_path, p.thumb_path, v.user_id AS owner_id, v.visibility
         FROM visit_photos p
         JOIN visits v ON v.id = p.visit_id
         WHERE p.id = $1`,
        [id],
      );
      const row = found.rows[0];
      if (!row) throw notFound('Deze foto bestaat niet.');

      const allowed = await canViewVisit(
        user.id,
        row.owner_id,
        row.visibility as 'private' | 'friends' | 'public_anonymous',
      );
      if (!allowed) throw notFound('Deze foto bestaat niet.');

      const relativePath = size === 'full' ? row.storage_path : row.thumb_path;
      const stats = await mediaFileStats(relativePath);

      return reply
        .type('image/webp')
        .header('content-length', String(stats.size))
        // private: een tussenliggende proxy of CDN mag dit niet delen.
        .header('cache-control', 'private, max-age=86400, no-transform')
        .send(mediaReadStream(relativePath));
    },
  );

  app.delete(
    '/photos/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.currentUser!;

      const paths = await withTransaction(async (client) => {
        const found = await client.query<{
          storage_path: string;
          thumb_path: string;
          owner_id: string;
        }>(
          `SELECT p.storage_path, p.thumb_path, v.user_id AS owner_id
           FROM visit_photos p JOIN visits v ON v.id = p.visit_id
           WHERE p.id = $1 FOR UPDATE OF p`,
          [id],
        );
        const row = found.rows[0];
        if (!row || row.owner_id !== user.id) throw notFound('Deze foto bestaat niet.');

        await client.query('DELETE FROM visit_photos WHERE id = $1', [id]);
        await recordAudit(
          { actorUserId: user.id, action: 'delete', entityType: 'visit_photo', entityId: id },
          client,
        );
        return row;
      });

      await deleteMediaFile(paths.storage_path);
      await deleteMediaFile(paths.thumb_path);
      return reply.status(204).send();
    },
  );
};

export default photoRoutes;
