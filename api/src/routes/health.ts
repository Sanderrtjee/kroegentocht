import type { FastifyPluginAsync } from 'fastify';
import { appPool, publicPool } from '../db/client.js';

/**
 * /healthz is de liveness-check en raakt de database niet aan: als de database
 * even weg is moet de container niet herstart worden, want dat helpt niets.
 *
 * /readyz raakt beide pools aan, inclusief de read-only pool, zodat een
 * verkeerd wachtwoord voor de publieke rol direct opvalt in plaats van pas als
 * iemand de kaart opent.
 */
const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    const checks: Record<string, 'ok' | 'fout'> = {};
    try {
      await appPool.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'fout';
    }
    try {
      await publicPool.query('SELECT 1 FROM public_venue_aggregates LIMIT 1');
      checks.publicView = 'ok';
    } catch {
      checks.publicView = 'fout';
    }
    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'fout', checks });
  });
};

export default healthRoutes;
