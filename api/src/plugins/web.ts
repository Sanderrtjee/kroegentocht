import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * Uitserveren van de gebouwde frontend.
 *
 * De api serveert de statische bestanden zelf, zodat er maar een container een
 * poort hoeft te publiceren. De mediamap staat expliciet niet in deze root: die
 * gaat alleen via het geauthenticeerde fotoendpoint.
 *
 * Onbekende paden krijgen index.html, want de frontend gebruikt client-side
 * routing. API-paden krijgen wel een echte 404 in JSON, want daar zou een
 * HTML-pagina alleen verwarring geven.
 */
const API_PREFIXES = ['/api', '/tiles', '/healthz', '/readyz'];

function isApiPath(url: string): boolean {
  return API_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`));
}

const webPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  if (!env.WEB_DIST_PATH) {
    app.setNotFoundHandler((request, reply) =>
      reply.status(404).send({
        error: 'not_found',
        message: `Onbekend endpoint: ${request.method} ${request.url}`,
      }),
    );
    return;
  }

  const root = path.resolve(env.WEB_DIST_PATH);

  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    index: ['index.html'],
    // Uit, zodat onbekende paden bij onze eigen notFoundHandler uitkomen.
    wildcard: false,
    // Sinds @fastify/static 10 krijgt deze callback een FastifyReply in plaats
    // van de rauwe ServerResponse.
    setHeaders(reply: FastifyReply, filePath: string) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Vite zet een contenthash in de bestandsnaam, dus dit mag lang blijven staan.
        reply.header('cache-control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        // De service worker en de entrypagina moeten altijd opnieuw gecontroleerd
        // worden, anders blijft een oude versie hangen na een deploy.
        reply.header('cache-control', 'no-cache');
      } else {
        reply.header('cache-control', 'public, max-age=3600');
      }
    },
  });

  app.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url)) {
      return reply.status(404).send({
        error: 'not_found',
        message: `Onbekend endpoint: ${request.method} ${request.url}`,
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.status(404).send({ error: 'not_found', message: 'Onbekend pad.' });
    }
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
};

export default fp(webPlugin, { name: 'web' });
