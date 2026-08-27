import cookie from '@fastify/cookie';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Role } from '@kroegentocht/shared';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, resolveSession } from '../lib/session.js';

/**
 * Sessieherkenning.
 *
 * Elk verzoek krijgt request.currentUser, ook als dat null is. Endpoints die een
 * login vereisen hangen app.requireAuth als preHandler; er is dus geen route die
 * per ongeluk open staat doordat iemand een check vergat te schrijven, want de
 * check staat in de routedefinitie en niet in de handler.
 */
const authPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    parseOptions: {},
  });

  app.decorateRequest('currentUser', null);

  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const user = await resolveSession(unsigned.value);
    request.currentUser = user;
  });

  app.decorate('requireAuth', async (request) => {
    if (!request.currentUser) throw unauthorized();
  });

  app.decorate('requireRole', (...roles: Role[]) => {
    return async (request) => {
      const user = request.currentUser;
      if (!user) throw unauthorized();
      if (!roles.includes(user.role)) {
        throw forbidden(`Hiervoor is de rol ${roles.join(' of ')} nodig.`);
      }
    };
  });
};

/** fastify-plugin, want de decorators moeten buiten dit plugin bruikbaar zijn. */
export default fp(authPlugin, { name: 'auth' });
