import type pg from 'pg';
import type { Visibility } from '@kroegentocht/shared';
import { appPool } from '../db/client.js';

export async function areFriends(
  a: string,
  b: string,
  executor: pg.Pool | pg.PoolClient | pg.Client = appPool,
): Promise<boolean> {
  if (a === b) return true;
  const result = await executor.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)
     LIMIT 1`,
    [a, b],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mag deze kijker dit bezoek in volle omvang zien, dus met fotos, deelnemers en
 * exact tijdstip?
 *
 * public_anonymous staat er bewust niet bij. Een publiek gemeld bezoek is alleen
 * te zien via de anonieme view, zonder eigenaar en zonder fotos. Wie het volledige
 * bezoek wil zien moet de eigenaar zijn, of een geaccepteerde vriend bij
 * zichtbaarheid friends.
 */
export async function canViewVisit(
  viewerId: string | null,
  ownerId: string,
  visibility: Visibility,
  executor: pg.Pool | pg.PoolClient | pg.Client = appPool,
): Promise<boolean> {
  if (!viewerId) return false;
  if (viewerId === ownerId) return true;
  if (visibility !== 'friends') return false;
  return areFriends(viewerId, ownerId, executor);
}
