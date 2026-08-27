import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

/**
 * IP-adressen worden alleen gebruikt om te rate limiten, en dan uitsluitend in
 * gehashte vorm.
 *
 * De HMAC-sleutel is het sessiegeheim gecombineerd met de dag van vandaag. Elke
 * dag verandert daarmee de pepper, dus een sleutel uit het geheugen van gisteren
 * is niet meer te koppelen aan het IP van vandaag. De uitkomst wordt afgekapt
 * tot 16 hextekens: genoeg om te tellen, te weinig om iets te reconstrueren.
 *
 * De hashes leven in het geheugen van het rate limit-plugin en gaan nooit naar
 * de database of het logboek.
 */
export function hashClientIp(ip: string, now: Date = new Date()): string {
  const dayBucket = now.toISOString().slice(0, 10);
  return createHmac('sha256', `${env.SESSION_SECRET}:${dayBucket}`)
    .update(ip)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Sleutel voor rate limiting. Ingelogde gebruikers worden per account geteld,
 * anonieme verzoeken per gehasht IP. Zo raakt een heel huishouden achter een NAT
 * niet in de weg te zitten zodra iemand is ingelogd.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const user = request.currentUser;
  if (user) return `user:${user.id}`;
  return `ip:${hashClientIp(request.ip)}`;
}
