import type pg from 'pg';
import { appPool } from '../db/client.js';

export type AuditAction = 'create' | 'update' | 'delete';

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  details?: Record<string, unknown>;
}

/**
 * Schrijft een regel in het auditlogboek.
 *
 * Er staat bewust geen IP-adres in. In details horen alleen velden die je later
 * echt nodig hebt om te reconstrueren wat er gebeurde; geen hele objecten, geen
 * wachtwoorden, geen foto-inhoud.
 *
 * Geef een client mee om de audit in dezelfde transactie te schrijven als de
 * wijziging zelf. Dan kan er geen wijziging zonder logregel bestaan.
 */
export async function recordAudit(
  entry: AuditEntry,
  client?: pg.PoolClient | pg.Client,
): Promise<void> {
  const executor = client ?? appPool;
  await executor.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId,
      JSON.stringify(entry.details ?? {}),
    ],
  );
}
