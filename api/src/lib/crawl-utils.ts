import type pg from 'pg';

/**
 * Herrekent de posities en de afstanden van een tocht.
 *
 * De afstand tussen twee stops is de geodetische afstand tussen de twee tenten,
 * berekend door PostGIS met ST_Distance op geography. Dat is hemelsbreed en dus
 * korter dan wat je echt gelopen hebt; de README zegt dat ook. Een looproute zou
 * een routeringsdienst vragen en die wil ik niet in een kroegapp hebben zitten.
 */
export async function recomputeCrawl(
  client: pg.PoolClient | pg.Client,
  crawlId: string,
): Promise<void> {
  // Eerst de posities opnieuw sluitend maken (0, 1, 2, ...) op basis van de
  // huidige volgorde. Na een verwijderde stop zitten er anders gaten in.
  await client.query(
    `WITH ordered AS (
       SELECT cs.id, row_number() OVER (ORDER BY cs.position, v.visited_at) - 1 AS new_position
       FROM crawl_stops cs
       JOIN visits v ON v.id = cs.visit_id
       WHERE cs.crawl_id = $1
     )
     UPDATE crawl_stops cs
     SET position = o.new_position
     FROM ordered o
     WHERE cs.id = o.id AND cs.position <> o.new_position`,
    [crawlId],
  );

  await client.query(
    `WITH ordered AS (
       SELECT cs.id,
              ven.location AS location,
              lag(ven.location) OVER (ORDER BY cs.position) AS previous_location
       FROM crawl_stops cs
       JOIN visits v ON v.id = cs.visit_id
       JOIN venues ven ON ven.id = v.venue_id
       WHERE cs.crawl_id = $1
     )
     UPDATE crawl_stops cs
     SET distance_from_prev_m = CASE
           WHEN o.previous_location IS NULL THEN NULL
           ELSE ST_Distance(o.location, o.previous_location)
         END
     FROM ordered o
     WHERE cs.id = o.id`,
    [crawlId],
  );
}

/**
 * Voegt een bezoek als laatste stop toe aan een tocht.
 *
 * Een bezoek hoort bij hoogstens een tocht (unieke constraint op visit_id), dus
 * een eventuele bestaande stop wordt eerst verwijderd. Zat het bezoek in een
 * andere tocht, dan wordt die tocht ook opnieuw gerekend, anders blijft daar een
 * gat in de posities en een verkeerde totaalafstand staan.
 */
export async function appendCrawlStop(
  client: pg.PoolClient | pg.Client,
  crawlId: string,
  visitId: string,
): Promise<void> {
  const removed = await client.query<{ crawl_id: string }>(
    'DELETE FROM crawl_stops WHERE visit_id = $1 RETURNING crawl_id',
    [visitId],
  );

  await client.query(
    `INSERT INTO crawl_stops (crawl_id, visit_id, position)
     SELECT $1, $2, COALESCE(max(position) + 1, 0)
     FROM crawl_stops WHERE crawl_id = $1`,
    [crawlId, visitId],
  );

  await recomputeCrawl(client, crawlId);

  const previousCrawlId = removed.rows[0]?.crawl_id;
  if (previousCrawlId && previousCrawlId !== crawlId) {
    await recomputeCrawl(client, previousCrawlId);
  }
}
