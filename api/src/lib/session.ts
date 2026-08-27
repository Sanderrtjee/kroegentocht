import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from '@kroegentocht/shared';
import type { Role } from '@kroegentocht/shared';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { env } from '../config/env.js';

/**
 * Serverside sessies met een ondoorzichtig token in een httpOnly-cookie.
 *
 * Alleen de sha256 van het token staat in de database. Wie de database leest kan
 * dus geen sessie overnemen. Het token zelf is 32 bytes uit de CSPRNG; er zit
 * geen betekenis in.
 */

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    signed: true,
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

/**
 * Zoekt de sessie op en verlengt last_seen_at hoogstens eens per vijf minuten,
 * zodat een druk gebruikte sessie niet elke request een schrijfactie kost.
 */
export async function resolveSession(token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const staleAfterMs = 5 * 60 * 1000;
  if (Date.now() - row.lastSeenAt.getTime() > staleAfterMs) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));
  }

  return { id: row.userId, username: row.username, role: row.role as Role };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Opruimen van verlopen sessies. Wordt periodiek door de api aangeroepen. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return result.length;
}

/** Alleen voor de seed en tests: hoeveel sessies zijn er nu. */
export async function countSessions(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(sessions);
  return rows[0]?.n ?? 0;
}
