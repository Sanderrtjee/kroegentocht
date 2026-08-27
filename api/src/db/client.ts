import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

/**
 * Twee gescheiden connectionpools.
 *
 * appPool draait als schema-eigenaar en doet al het gewone werk.
 *
 * publicPool draait als de rol kroeg_public. Die rol heeft geen SELECT op
 * visits, users, visit_photos of visit_attendees en staat op read-only. Alles
 * wat de anonieme kaartlaag en de anonieme meldingsteksten uitserveert gaat via
 * deze pool. Een fout in een publiek endpoint kan daardoor geen persoonsgegevens
 * lekken: de database weigert de query gewoon.
 */

const { Pool } = pg;

/**
 * numeric komt standaard als string terug uit node-postgres, wat correct maar
 * onhandig is voor avg_rating. We parsen numeric (OID 1700) naar number; de
 * waarden hier zijn ratings en afstanden, geen bedragen waar precisie telt.
 */
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
/** int8/bigint (OID 20) naar number: osm_id past ruim binnen Number.MAX_SAFE_INTEGER. */
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export const appPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_MAX_CONNECTIONS,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'kroegentocht-api',
});

export const publicPool = new Pool({
  connectionString: env.DATABASE_PUBLIC_URL,
  max: env.DB_PUBLIC_MAX_CONNECTIONS,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'kroegentocht-api-public',
});

export const db = drizzle(appPool, { schema });
export type Db = typeof db;

/** Voer werk uit in een transactie op de volledige-rechtenpool. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* verbinding al stuk; de pool ruimt hem op */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.allSettled([appPool.end(), publicPool.end()]);
}
