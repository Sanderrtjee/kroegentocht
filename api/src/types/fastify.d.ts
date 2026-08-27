import type { SessionUser } from '../lib/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Ingelogde gebruiker, of null bij een anoniem verzoek. */
    currentUser: SessionUser | null;
  }

  interface FastifyInstance {
    /** preHandler die 401 geeft als er geen sessie is. */
    requireAuth: import('fastify').preHandlerHookHandler;
    /** preHandler-fabriek die 403 geeft bij een onvoldoende rol. */
    requireRole: (
      ...roles: Array<'user' | 'moderator' | 'admin'>
    ) => import('fastify').preHandlerHookHandler;
  }
}
