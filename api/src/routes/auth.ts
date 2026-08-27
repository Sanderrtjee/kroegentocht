import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, registerSchema } from '@kroegentocht/shared';
import type { MeDto, Role } from '@kroegentocht/shared';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { conflict, forbidden, unauthorized } from '../lib/errors.js';
import { fakeVerifyDelay, hashPassword, verifyPassword } from '../lib/password.js';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  cookieOptions,
  createSession,
  destroySession,
} from '../lib/session.js';
import { loginRateLimit, registerRateLimit } from '../plugins/security.js';

/** Vergelijking in constante tijd, zodat de uitnodigingscode niet teken voor
 *  teken te raden is uit de responstijd. */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/register',
    { schema: { body: registerSchema }, config: registerRateLimit },
    async (request, reply) => {
      const { username, password, inviteCode } = request.body as {
        username: string;
        password: string;
        inviteCode: string;
      };

      if (!env.REGISTRATION_ENABLED) {
        throw forbidden('Registratie staat uit.');
      }
      if (!secretEquals(inviteCode, env.INVITE_CODE)) {
        // Zelfde behandeling als een fout wachtwoord: geen hint of de code
        // bestond maar verlopen was, want dat is er niet.
        throw forbidden('Ongeldige uitnodigingscode.');
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      if (existing.length > 0) {
        throw conflict('Deze gebruikersnaam is al in gebruik.');
      }

      const passwordHash = await hashPassword(password);
      const inserted = await db
        .insert(users)
        .values({ username, passwordHash })
        .returning({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt });

      const user = inserted[0];
      if (!user) throw conflict('Aanmaken van het account is niet gelukt.');

      await recordAudit({
        actorUserId: user.id,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        details: { username: user.username },
      });

      const token = await createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_SECONDS));

      const body: MeDto = {
        id: user.id,
        username: user.username,
        role: user.role as Role,
        createdAt: user.createdAt.toISOString(),
      };
      return reply.status(201).send(body);
    },
  );

  app.post(
    '/login',
    { schema: { body: loginSchema }, config: loginRateLimit },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };

      const found = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          passwordHash: users.passwordHash,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      const user = found[0];
      if (!user) {
        // Even lang wachten als bij een bestaande gebruiker, zodat de
        // responstijd niet verklapt welke namen bestaan.
        await fakeVerifyDelay();
        throw unauthorized('Gebruikersnaam of wachtwoord is onjuist.');
      }

      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) throw unauthorized('Gebruikersnaam of wachtwoord is onjuist.');

      const token = await createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_SECONDS));

      await recordAudit({
        actorUserId: user.id,
        action: 'create',
        entityType: 'session',
        entityId: null,
      });

      const body: MeDto = {
        id: user.id,
        username: user.username,
        role: user.role as Role,
        createdAt: user.createdAt.toISOString(),
      };
      return body;
    },
  );

  app.post('/logout', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await destroySession(unsigned.value);
        await recordAudit({
          actorUserId: request.currentUser?.id ?? null,
          action: 'delete',
          entityType: 'session',
          entityId: null,
        });
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (request, reply) => {
    const user = request.currentUser;
    if (!user) return reply.status(401).send({ error: 'unauthorized', message: 'Niet ingelogd.' });

    const rows = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const body: MeDto = {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: (rows[0]?.createdAt ?? new Date()).toISOString(),
    };
    return body;
  });

  app.get('/registration-status', async () => ({
    enabled: env.REGISTRATION_ENABLED,
    inviteRequired: true,
  }));
};

export default authRoutes;
