import archiver from 'archiver';
import type { FastifyPluginAsync } from 'fastify';
import { appPool } from '../db/client.js';
import { fetchVisitsByIds } from '../lib/visit-queries.js';
import { mediaReadStream, resolveMediaPath } from '../lib/storage.js';

/**
 * Data-export.
 *
 * Twee vormen: alles als JSON, en de fotos als zip. Samen is dat een volledige
 * kopie van wat er van deze gebruiker in het systeem staat, wat nodig is om een
 * inzage- of overdraagbaarheidsverzoek te kunnen inwilligen zonder handwerk in
 * de database.
 */
const exportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/json', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = request.currentUser!;

    const account = await appPool.query<{ username: string; role: string; created_at: Date }>(
      'SELECT username::text AS username, role, created_at FROM users WHERE id = $1',
      [user.id],
    );

    const visitIds = await appPool.query<{ id: string }>(
      'SELECT id FROM visits WHERE user_id = $1 ORDER BY visited_at ASC',
      [user.id],
    );
    const visits = await fetchVisitsByIds(visitIds.rows.map((r) => r.id));

    const people = await appPool.query<{ id: string; name: string; created_at: Date }>(
      'SELECT id, name, created_at FROM people WHERE user_id = $1 ORDER BY lower(name)',
      [user.id],
    );

    const crawls = await appPool.query<{
      id: string;
      name: string;
      crawl_date: string;
      notes: string;
      stops: Array<{ position: number; visitId: string; distanceFromPrevM: number | null }>;
    }>(
      `SELECT c.id, c.name, c.crawl_date, c.notes,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'position', cs.position,
                         'visitId', cs.visit_id,
                         'distanceFromPrevM', cs.distance_from_prev_m
                       ) ORDER BY cs.position)
                FROM crawl_stops cs WHERE cs.crawl_id = c.id
              ), '[]'::json) AS stops
       FROM crawls c WHERE c.user_id = $1
       ORDER BY c.crawl_date ASC`,
      [user.id],
    );

    const friends = await appPool.query<{ username: string; status: string }>(
      `SELECT u.username::text AS username, f.status
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.requester_id = $1 OR f.addressee_id = $1`,
      [user.id],
    );

    const accountRow = account.rows[0];

    return reply
      .header('content-disposition', 'attachment; filename="kroegentocht-export.json"')
      .type('application/json; charset=utf-8')
      .send({
        exportedAt: new Date().toISOString(),
        formatVersion: 1,
        account: accountRow
          ? {
              username: accountRow.username,
              role: accountRow.role,
              createdAt: accountRow.created_at.toISOString(),
            }
          : null,
        // De bestanden zelf zitten in de zip-export; hier staat alleen de metadata.
        visits: visitIds.rows.map((r) => visits.get(r.id)).filter(Boolean),
        people: people.rows.map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.created_at.toISOString(),
        })),
        crawls: crawls.rows.map((c) => ({
          id: c.id,
          name: c.name,
          crawlDate: String(c.crawl_date),
          notes: c.notes,
          stops: c.stops,
        })),
        friends: friends.rows,
      });
  });

  /**
   * Alle eigen fotos als zip. De bestanden zitten er in als
   * <bezoekdatum>_<tentnaam>/<positie>.webp, zodat de zip ook zonder de
   * JSON-export leesbaar is.
   */
  app.get('/photos.zip', { preHandler: app.requireAuth }, async (request, reply) => {
    const user = request.currentUser!;

    const photos = await appPool.query<{
      id: string;
      storage_path: string;
      position: number;
      visited_at: Date;
      venue_name: string;
    }>(
      `SELECT p.id, p.storage_path, p.position, v.visited_at, ven.name AS venue_name
       FROM visit_photos p
       JOIN visits v ON v.id = p.visit_id
       JOIN venues ven ON ven.id = v.venue_id
       WHERE v.user_id = $1
       ORDER BY v.visited_at ASC, p.position ASC`,
      [user.id],
    );

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => request.log.warn({ err }, 'zip-waarschuwing'));
    archive.on('error', (err) => request.log.error({ err }, 'zip-fout'));

    for (const photo of photos.rows) {
      const safeVenue = photo.venue_name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60).trim();
      const day = photo.visited_at.toISOString().slice(0, 10);
      const entryName = `${day}_${safeVenue || 'tent'}/${String(photo.position).padStart(2, '0')}_${photo.id.slice(0, 8)}.webp`;
      try {
        // resolveMediaPath weigert paden buiten de mediamap.
        resolveMediaPath(photo.storage_path);
        archive.append(mediaReadStream(photo.storage_path), { name: entryName });
      } catch (err) {
        request.log.warn({ err, photoId: photo.id }, 'foto overgeslagen in export');
      }
    }

    void archive.finalize();

    return reply
      .header('content-disposition', 'attachment; filename="kroegentocht-fotos.zip"')
      .type('application/zip')
      .send(archive);
  });
};

export default exportRoutes;
