import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { MAX_PHOTOS_PER_VISIT, MAX_UPLOAD_BYTES } from '@kroegentocht/shared';
import { env, isProd } from './config/env.js';
import { registerValidation } from './lib/validation.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';
import webPlugin from './plugins/web.js';
import accountRoutes from './routes/account.js';
import authRoutes from './routes/auth.js';
import crawlRoutes from './routes/crawls.js';
import exportRoutes from './routes/export.js';
import friendRoutes from './routes/friends.js';
import geocodeRoutes from './routes/geocode.js';
import healthRoutes from './routes/health.js';
import mapRoutes from './routes/map.js';
import moderationRoutes from './routes/moderation.js';
import peopleRoutes from './routes/people.js';
import photoRoutes from './routes/photos.js';
import statsRoutes from './routes/stats.js';
import tileRoutes from './routes/tiles.js';
import venueRoutes from './routes/venues.js';
import visitRoutes from './routes/visits.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Bewust geen remoteAddress in de logregels. IP-adressen worden alleen
      // gehasht en in het geheugen gebruikt voor rate limiting; ze horen niet in
      // een logbestand dat weken blijft staan.
      serializers: {
        req(request: { method: string; url: string; routeOptions?: { url?: string } }) {
          return {
            method: request.method,
            url: request.url,
            routeUrl: request.routeOptions?.url,
          };
        },
      },
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        remove: true,
      },
    },
    /**
     * Alleen headers van de proxy uit deze bereiken worden vertrouwd voor het
     * echte client-IP. Zonder deze beperking kan iedereen X-Forwarded-For
     * verzinnen en daarmee de rate limiting omzeilen.
     */
    trustProxy: env.TRUSTED_PROXY_CIDRS,
    bodyLimit: 1_048_576,
    disableRequestLogging: false,
    ignoreTrailingSlash: true,
  });

  registerValidation(app);

  await app.register(securityPlugin);
  await app.register(authPlugin);

  await app.register(compress, {
    global: true,
    threshold: 1024,
    // webp en png zijn al gecomprimeerd; nog een ronde kost cpu en levert niets.
    encodings: ['br', 'gzip', 'deflate'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: MAX_PHOTOS_PER_VISIT,
      fields: 10,
      fieldSize: 4096,
    },
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/me' });
  await app.register(peopleRoutes, { prefix: '/api/people' });
  await app.register(friendRoutes, { prefix: '/api/friends' });
  await app.register(venueRoutes, { prefix: '/api/venues' });
  await app.register(visitRoutes, { prefix: '/api/visits' });
  await app.register(photoRoutes, { prefix: '/api' });
  await app.register(crawlRoutes, { prefix: '/api/crawls' });
  await app.register(mapRoutes, { prefix: '/api/map' });
  await app.register(statsRoutes, { prefix: '/api/stats' });
  await app.register(exportRoutes, { prefix: '/api/export' });
  await app.register(moderationRoutes, { prefix: '/api/moderation' });
  await app.register(geocodeRoutes, { prefix: '/api/geocode' });
  await app.register(tileRoutes, { prefix: '/tiles' });

  // Als laatste, want deze zet de notFoundHandler.
  await app.register(webPlugin);

  if (!isProd) {
    app.log.info('ontwikkelmodus: cookies zijn %s', env.COOKIE_SECURE ? 'secure' : 'niet secure');
  }

  return app;
}
