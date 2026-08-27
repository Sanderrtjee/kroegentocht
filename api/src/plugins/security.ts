import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { env, isProd } from '../config/env.js';
import { rateLimitKey } from '../lib/client-ip.js';

/**
 * Securityheaders en rate limiting.
 *
 * De Content Security Policy staat geen inline scripts toe. De Vite-build
 * produceert alleen externe modulebestanden, dus dat werkt zonder nonces.
 *
 * Er is precies een uitzondering: style-src-attr staat inline stijlattributen
 * toe. Leaflet positioneert tiles en markers met stijlattributen; zonder deze
 * uitzondering staat de kaart stil. Inline stylesheets en inline scripts blijven
 * verboden, dus het aanvalsoppervlak dat hoort bij script-injectie verandert
 * hier niet.
 */
const securityPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'none'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'script-src': ["'self'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'"],
        'style-src-attr': ["'unsafe-inline'"],
        // blob: en data: zijn nodig voor de voorbeeldweergave van een foto die
        // nog in de offline wachtrij staat en dus nog geen server-URL heeft.
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
        'manifest-src': ["'self'"],
        'frame-src': ["'none'"],
        ...(isProd ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    // TLS wordt door Nginx Proxy Manager afgehandeld. De header gaat mee naar
    // buiten via de proxy; de browser ziet hem dus over https.
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: false,
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // De kaarttiles komen van onze eigen proxy, dus geen cross-origin isolatie
    // nodig die embedding van eigen resources zou breken.
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    timeWindow: '1 minute',
    /**
     * Sleutels zijn per account of per gehasht IP. Er wordt nergens een ruw
     * IP-adres bewaard; zie lib/client-ip.ts.
     */
    keyGenerator: rateLimitKey,
    // In-memory store. Er draait een enkele api-container, dus dat volstaat en
    // het spaart een Redis in de stack.
    continueExceeding: false,
    addHeadersOnExceeding: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
    },
    errorResponseBuilder: (_request: unknown, context: { ttl: number }) => ({
      error: 'too_many_requests',
      message: `Te veel verzoeken. Probeer het over ${Math.ceil(context.ttl / 1000)} seconden opnieuw.`,
    }),
  });
};

export default fp(securityPlugin, { name: 'security' });

/** Strengere limieten voor de gevoelige endpoints, per route mee te geven. */
export const loginRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_LOGIN_PER_15MIN, timeWindow: '15 minutes' },
};

export const registerRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_REGISTER_PER_HOUR, timeWindow: '1 hour' },
};

export const uploadRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_UPLOAD_PER_HOUR, timeWindow: '1 hour' },
};

export const geocodeRateLimit = {
  rateLimit: { max: env.RATE_LIMIT_GEOCODE_PER_MINUTE, timeWindow: '1 minute' },
};
