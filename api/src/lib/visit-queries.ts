import type pg from 'pg';
import type { Visibility, VisitDto, VisitListQuery } from '@kroegentocht/shared';
import { appPool } from '../db/client.js';

/**
 * Alle leesqueries voor bezoeken op een plek.
 *
 * Een bezoek is opgebouwd uit vier tabellen (visit, venue, fotos, aanwezigen).
 * Dat wordt hier in een query gedaan met json_agg in laterale subselects, zodat
 * er geen N+1 ontstaat als je een tijdlijn van vijftien kroegen ophaalt.
 */

const VISIT_SELECT = `
  SELECT
    v.id,
    v.visited_at,
    v.description,
    v.rating,
    v.price_indication,
    v.tags,
    v.visibility,
    v.created_at,
    v.updated_at,
    v.user_id,
    ven.id      AS venue_id,
    ven.name    AS venue_name,
    ven.street  AS venue_street,
    ven.city    AS venue_city,
    ven.country AS venue_country,
    ven.osm_id  AS venue_osm_id,
    ST_Y(ven.location::geometry) AS venue_lat,
    ST_X(ven.location::geometry) AS venue_lon,
    cs.crawl_id,
    COALESCE(ph.photos, '[]'::json)    AS photos,
    COALESCE(att.attendees, '[]'::json) AS attendees
  FROM visits v
  JOIN venues ven ON ven.id = v.venue_id
  LEFT JOIN crawl_stops cs ON cs.visit_id = v.id
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object('id', p.id, 'width', p.width, 'height', p.height, 'position', p.position)
             ORDER BY p.position
           ) AS photos
    FROM visit_photos p
    WHERE p.visit_id = v.id
  ) ph ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object(
               'id', a.id,
               'personId', a.person_id,
               'name', COALESCE(pe.name, a.free_name)
             )
             ORDER BY COALESCE(pe.name, a.free_name)
           ) AS attendees
    FROM visit_attendees a
    LEFT JOIN people pe ON pe.id = a.person_id
    WHERE a.visit_id = v.id
  ) att ON true
`;

interface VisitRow {
  id: string;
  visited_at: Date;
  description: string;
  rating: number;
  price_indication: number | null;
  tags: string[];
  visibility: string;
  created_at: Date;
  updated_at: Date;
  user_id: string;
  venue_id: string;
  venue_name: string;
  venue_street: string | null;
  venue_city: string | null;
  venue_country: string | null;
  venue_osm_id: number | null;
  venue_lat: number;
  venue_lon: number;
  crawl_id: string | null;
  photos: Array<{ id: string; width: number; height: number; position: number }>;
  attendees: Array<{ id: string; personId: string | null; name: string }>;
}

export function photoUrl(photoId: string, size: 'thumb' | 'full'): string {
  return `/api/photos/${photoId}?size=${size}`;
}

export function rowToVisitDto(row: VisitRow): VisitDto {
  return {
    id: row.id,
    venue: {
      id: row.venue_id,
      name: row.venue_name,
      street: row.venue_street,
      city: row.venue_city,
      country: row.venue_country,
      lat: Number(row.venue_lat),
      lon: Number(row.venue_lon),
      osmId: row.venue_osm_id === null ? null : Number(row.venue_osm_id),
    },
    visitedAt: row.visited_at.toISOString(),
    description: row.description,
    rating: Number(row.rating),
    priceIndication: row.price_indication === null ? null : Number(row.price_indication),
    tags: row.tags ?? [],
    visibility: row.visibility as Visibility,
    attendees: (row.attendees ?? []).filter((a) => a.name != null),
    photos: (row.photos ?? []).map((p) => ({
      id: p.id,
      width: p.width,
      height: p.height,
      position: p.position,
      thumbUrl: photoUrl(p.id, 'thumb'),
      fullUrl: photoUrl(p.id, 'full'),
    })),
    crawlId: row.crawl_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function fetchVisitById(
  visitId: string,
  executor: pg.Pool | pg.PoolClient | pg.Client = appPool,
): Promise<{ visit: VisitDto; ownerId: string } | null> {
  const result = await executor.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = $1`, [visitId]);
  const row = result.rows[0];
  if (!row) return null;
  return { visit: rowToVisitDto(row), ownerId: row.user_id };
}

export async function fetchVisitsByIds(
  visitIds: readonly string[],
  executor: pg.Pool | pg.PoolClient | pg.Client = appPool,
): Promise<Map<string, VisitDto>> {
  if (visitIds.length === 0) return new Map();
  const result = await executor.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = ANY($1::uuid[])`, [
    visitIds,
  ]);
  return new Map(result.rows.map((row) => [row.id, rowToVisitDto(row)]));
}

interface FilterBuild {
  where: string[];
  params: unknown[];
}

function buildFilters(userId: string, q: Partial<VisitListQuery>): FilterBuild {
  const where: string[] = [];
  const params: unknown[] = [];

  params.push(userId);
  where.push(`v.user_id = $${params.length}`);

  if (q.ratingMin !== undefined) {
    params.push(q.ratingMin);
    where.push(`v.rating >= $${params.length}`);
  }
  if (q.ratingMax !== undefined) {
    params.push(q.ratingMax);
    where.push(`v.rating <= $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`v.visited_at >= ($${params.length}::date)`);
  }
  if (q.to) {
    // Inclusief de einddatum zelf: alles voor het begin van de dag erna.
    params.push(q.to);
    where.push(`v.visited_at < (($${params.length}::date) + INTERVAL '1 day')`);
  }
  if (q.city) {
    params.push(q.city);
    where.push(`lower(ven.city) = lower($${params.length})`);
  }
  if (q.tags && q.tags.length > 0) {
    params.push(q.tags);
    where.push(`v.tags @> $${params.length}::text[]`);
  }
  if (q.personId) {
    params.push(q.personId);
    where.push(
      `EXISTS (SELECT 1 FROM visit_attendees a2 WHERE a2.visit_id = v.id AND a2.person_id = $${params.length})`,
    );
  }
  if (q.crawlId) {
    params.push(q.crawlId);
    where.push(`cs.crawl_id = $${params.length}`);
  }
  if (q.visibility) {
    params.push(q.visibility);
    where.push(`v.visibility = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(v.description ILIKE $${params.length} OR ven.name ILIKE $${params.length})`);
  }

  return { where, params };
}

const SORTS: Record<string, string> = {
  visited_desc: 'v.visited_at DESC, v.created_at DESC',
  visited_asc: 'v.visited_at ASC, v.created_at ASC',
  rating_desc: 'v.rating DESC, v.visited_at DESC',
};

export async function fetchVisitList(
  userId: string,
  q: VisitListQuery,
): Promise<{ items: VisitDto[]; total: number }> {
  const { where, params } = buildFilters(userId, q);
  const orderBy = SORTS[q.sort] ?? SORTS.visited_desc!;

  const countSql = `
    SELECT count(*)::int AS total
    FROM visits v
    JOIN venues ven ON ven.id = v.venue_id
    LEFT JOIN crawl_stops cs ON cs.visit_id = v.id
    WHERE ${where.join(' AND ')}
  `;
  const countResult = await appPool.query<{ total: number }>(countSql, params);

  const pageParams = [...params, q.limit, (q.page - 1) * q.limit];
  const listSql = `
    ${VISIT_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
  `;
  const listResult = await appPool.query<VisitRow>(listSql, pageParams);

  return {
    items: listResult.rows.map(rowToVisitDto),
    total: countResult.rows[0]?.total ?? 0,
  };
}

export { VISIT_SELECT };
export type { VisitRow };
