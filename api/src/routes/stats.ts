import type { FastifyPluginAsync } from 'fastify';
import type { StatsDto } from '@kroegentocht/shared';
import { appPool } from '../db/client.js';

/**
 * Statistiek over de eigen bezoeken. Alles is per gebruiker; er zit geen enkele
 * doorkijk naar bezoeken van anderen in.
 */
const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;

    const totals = await appPool.query<{
      visit_count: number;
      venue_count: number;
      city_count: number;
      average_rating: number | null;
    }>(
      `SELECT count(*)::int AS visit_count,
              count(DISTINCT v.venue_id)::int AS venue_count,
              count(DISTINCT lower(ven.city))::int AS city_count,
              avg(v.rating)::float8 AS average_rating
       FROM visits v JOIN venues ven ON ven.id = v.venue_id
       WHERE v.user_id = $1`,
      [user.id],
    );

    const crawlTotals = await appPool.query<{ crawl_count: number; total_distance_m: number }>(
      `SELECT count(DISTINCT c.id)::int AS crawl_count,
              COALESCE(sum(cs.distance_from_prev_m), 0)::float8 AS total_distance_m
       FROM crawls c LEFT JOIN crawl_stops cs ON cs.crawl_id = c.id
       WHERE c.user_id = $1`,
      [user.id],
    );

    /**
     * Hoogst gewaardeerde tent. Bij een gelijk gemiddelde wint de tent waar je
     * vaker was: een 5 die je twee keer gaf zegt meer dan een eenmalige 5.
     */
    const topVenue = await appPool.query<{
      venue_id: string;
      name: string;
      city: string | null;
      avg_rating: number;
      visit_count: number;
    }>(
      `SELECT ven.id AS venue_id, ven.name, ven.city,
              avg(v.rating)::float8 AS avg_rating,
              count(*)::int AS visit_count
       FROM visits v JOIN venues ven ON ven.id = v.venue_id
       WHERE v.user_id = $1
       GROUP BY ven.id, ven.name, ven.city
       ORDER BY avg_rating DESC, visit_count DESC, ven.name ASC
       LIMIT 1`,
      [user.id],
    );

    /** Vaakste metgezel, over zowel de maatjeslijst als eenmalige namen. */
    const topCompanion = await appPool.query<{ name: string; visit_count: number }>(
      `SELECT COALESCE(pe.name, a.free_name) AS name, count(DISTINCT a.visit_id)::int AS visit_count
       FROM visit_attendees a
       JOIN visits v ON v.id = a.visit_id
       LEFT JOIN people pe ON pe.id = a.person_id
       WHERE v.user_id = $1 AND COALESCE(pe.name, a.free_name) IS NOT NULL
       GROUP BY COALESCE(pe.name, a.free_name)
       ORDER BY visit_count DESC, name ASC
       LIMIT 1`,
      [user.id],
    );

    const histogram = await appPool.query<{ rating: number; count: number }>(
      `SELECT v.rating::int AS rating, count(*)::int AS count
       FROM visits v WHERE v.user_id = $1
       GROUP BY v.rating ORDER BY v.rating ASC`,
      [user.id],
    );

    const perMonth = await appPool.query<{ month: string; visit_count: number }>(
      `SELECT to_char(v.visited_month, 'YYYY-MM') AS month, count(*)::int AS visit_count
       FROM visits v WHERE v.user_id = $1
       GROUP BY v.visited_month ORDER BY v.visited_month ASC`,
      [user.id],
    );

    const totalsRow = totals.rows[0];
    const crawlRow = crawlTotals.rows[0];
    const venueRow = topVenue.rows[0];
    const companionRow = topCompanion.rows[0];

    const body: StatsDto = {
      venueCount: totalsRow?.venue_count ?? 0,
      visitCount: totalsRow?.visit_count ?? 0,
      cityCount: totalsRow?.city_count ?? 0,
      crawlCount: crawlRow?.crawl_count ?? 0,
      totalDistanceM: Math.round(crawlRow?.total_distance_m ?? 0),
      averageRating:
        totalsRow?.average_rating == null
          ? null
          : Math.round(totalsRow.average_rating * 100) / 100,
      topVenue: venueRow
        ? {
            venueId: venueRow.venue_id,
            name: venueRow.name,
            city: venueRow.city,
            avgRating: Math.round(venueRow.avg_rating * 100) / 100,
            visitCount: venueRow.visit_count,
          }
        : null,
      topCompanion: companionRow
        ? { name: companionRow.name, visitCount: companionRow.visit_count }
        : null,
      ratingHistogram: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: histogram.rows.find((r) => Number(r.rating) === rating)?.count ?? 0,
      })),
      perMonth: perMonth.rows.map((r) => ({ month: r.month, visitCount: r.visit_count })),
    };
    return body;
  });
};

export default statsRoutes;
