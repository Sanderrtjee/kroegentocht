import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Integratietest over de belangrijkste routes, tegen een echte PostgreSQL met
 * PostGIS. Zonder echte database heeft deze test geen zin: het interessante
 * gedrag zit juist in de views, de rolrechten en de ruimtelijke queries.
 *
 * Starten:
 *   docker compose -f ops/compose.test.yaml up -d
 *   npm run test:integration -w api
 *
 * Zonder database wordt de hele suite overgeslagen in plaats van rood te worden,
 * zodat npm test op een machine zonder Docker nog steeds bruikbaar is.
 */

const TEST_DB_HOST = process.env.TEST_DB_HOST ?? '127.0.0.1';
const TEST_DB_PORT = process.env.TEST_DB_PORT ?? '55432';
const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'kroegentocht_test';
const TEST_DB_USER = process.env.TEST_DB_USER ?? 'kroeg_test';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? 'kroeg_test_wachtwoord';
const PUBLIC_ROLE_PASSWORD = 'kroeg_public_test_wachtwoord';

const INVITE_CODE = 'test-uitnodiging-1234';

const mediaRoot = await mkdtemp(path.join(tmpdir(), 'kroegentocht-media-'));
const tileRoot = await mkdtemp(path.join(tmpdir(), 'kroegentocht-tiles-'));

// Alle configuratie voordat er ook maar iets uit src wordt geladen: config/env.ts
// valideert bij het importeren en gooit als er iets ontbreekt.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: `postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}`,
  DATABASE_PUBLIC_URL: `postgresql://kroeg_public:${PUBLIC_ROLE_PASSWORD}@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}`,
  SESSION_SECRET: 'test-sessiegeheim-dat-minstens-32-tekens-lang-is',
  INVITE_CODE,
  COOKIE_SECURE: 'false',
  MEDIA_ROOT: mediaRoot,
  TILE_CACHE_ROOT: tileRoot,
  CONTACT_EMAIL: 'test@voorbeeld.nl',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  WEB_DIST_PATH: '',
  // Ruim, anders lopen de tests zelf tegen de rate limiting aan.
  RATE_LIMIT_GLOBAL_PER_MINUTE: '100000',
  RATE_LIMIT_LOGIN_PER_15MIN: '1000',
  RATE_LIMIT_REGISTER_PER_HOUR: '1000',
  RATE_LIMIT_UPLOAD_PER_HOUR: '1000',
});

async function databaseReachable(): Promise<boolean> {
  try {
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await databaseReachable();
const suite = reachable ? describe : describe.skip;

if (!reachable) {
  process.stdout.write(
    `\n[integratietest] overgeslagen: geen database op ${TEST_DB_HOST}:${TEST_DB_PORT}.\n` +
      '  Start hem met: docker compose -f ops/compose.test.yaml up -d\n\n',
  );
}

/** Bouwt een multipart/form-data body zonder extra afhankelijkheid. */
function multipartBody(
  files: Array<{ field: string; filename: string; contentType: string; data: Buffer }>,
): { payload: Buffer; contentType: string } {
  const boundary = `----kroegentocht${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Haalt de sessiecookie uit een set-cookie header. */
function sessionCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : [String(raw)];
  const cookie = all.find((c) => c.startsWith('kt_session='));
  if (!cookie) throw new Error('geen sessiecookie in het antwoord');
  return cookie.split(';')[0]!.split('=').slice(1).join('=');
}

suite('api integratie', () => {
  let app: FastifyInstance;
  let appPool: import('pg').Pool;
  let closePools: () => Promise<void>;

  /** Sessies per gebruikersnaam. */
  const sessions = new Map<string, string>();

  const request = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    options: { as?: string; body?: unknown; raw?: { payload: Buffer; contentType: string } } = {},
  ) => {
    const cookies = options.as ? { kt_session: sessions.get(options.as)! } : undefined;
    if (options.raw) {
      return app.inject({
        method,
        url,
        ...(cookies ? { cookies } : {}),
        headers: { 'content-type': options.raw.contentType },
        payload: options.raw.payload,
      });
    }
    return app.inject({
      method,
      url,
      ...(cookies ? { cookies } : {}),
      ...(options.body !== undefined ? { payload: options.body as object } : {}),
    });
  };

  const registerUser = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'wachtwoord-voor-de-test', inviteCode: INVITE_CODE },
    });
    expect(response.statusCode, response.body).toBe(201);
    sessions.set(username, sessionCookie(response.headers as Record<string, unknown>));
    return response.json() as { id: string; username: string };
  };

  const createVisit = async (
    username: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; venue: { id: string; name: string } }> => {
    const response = await request('POST', '/api/visits', { as: username, body });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };

  beforeAll(async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations();

    const client = await import('../../src/db/client.js');
    appPool = client.appPool;
    closePools = client.closePools;

    // Schoon beginnen, ook als er nog resten van een vorige run staan.
    await appPool.query('TRUNCATE users, venues, audit_log RESTART IDENTITY CASCADE');

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await closePools?.();
    await rm(mediaRoot, { recursive: true, force: true });
    await rm(tileRoot, { recursive: true, force: true });
  });

  describe('registreren en inloggen', () => {
    it('weigert registratie zonder geldige uitnodigingscode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'indringer', password: 'wachtwoord-voor-de-test', inviteCode: 'fout' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('registreert met de juiste code en zet een httpOnly sessiecookie', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username: 'sander',
          password: 'wachtwoord-voor-de-test',
          inviteCode: INVITE_CODE,
        },
      });
      expect(response.statusCode, response.body).toBe(201);

      const setCookie = response.headers['set-cookie'];
      const cookieString = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
      expect(cookieString).toContain('HttpOnly');
      expect(cookieString).toContain('SameSite=Lax');

      sessions.set('sander', sessionCookie(response.headers as Record<string, unknown>));
    });

    it('geeft 401 op een beschermd endpoint zonder sessie', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/visits' });
      expect(response.statusCode).toBe(401);
    });

    it('herkent de sessie op /api/auth/me', async () => {
      const response = await request('GET', '/api/auth/me', { as: 'sander' });
      expect(response.statusCode).toBe(200);
      expect(response.json().username).toBe('sander');
    });

    it('wijst een fout wachtwoord af', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'sander', password: 'niet-het-wachtwoord' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('validatie', () => {
    it('wijst een ongeldige body af met details', async () => {
      const response = await request('POST', '/api/visits', {
        as: 'sander',
        body: { rating: 9, visitedAt: 'gisteren' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('validation_failed');
      expect(Array.isArray(response.json().details)).toBe(true);
    });

    it('valideert ook de querystring', async () => {
      const response = await request('GET', '/api/map/mine?bbox=onzin', { as: 'sander' });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('validation_failed');
    });
  });

  describe('bezoeken en deduplicatie van tenten', () => {
    let firstVenueId = '';

    it('maakt een bezoek met een nieuwe tent', async () => {
      const visit = await createVisit('sander', {
        venue: {
          name: 'Cafe De Zwaan',
          street: 'Oudegracht 121',
          city: 'Utrecht',
          lat: 52.09183,
          lon: 5.11889,
        },
        visitedAt: '2026-03-14T19:30:00+01:00',
        description: 'Prima begin van de avond.',
        rating: 4,
        tags: ['bier', 'gezellig'],
        visibility: 'public_anonymous',
        attendees: [{ name: 'Bram', remember: true }],
      });
      expect(visit.venue.name).toBe('Cafe De Zwaan');
      firstVenueId = visit.venue.id;
    });

    it('koppelt een andere spelling binnen 50 meter aan dezelfde tent', async () => {
      // Ongeveer 25 meter verderop, andere naam voor dezelfde kroeg.
      const visit = await createVisit('sander', {
        venue: {
          name: "Grand Cafe 't Zwaan",
          city: 'Utrecht',
          lat: 52.09205,
          lon: 5.11898,
        },
        visitedAt: '2026-03-21T20:00:00+01:00',
        rating: 3,
        visibility: 'private',
      });
      expect(visit.venue.id).toBe(firstVenueId);
    });

    it('maakt wel een nieuwe tent voor een andere naam op hetzelfde adres', async () => {
      const visit = await createVisit('sander', {
        venue: { name: 'Het Anker', city: 'Utrecht', lat: 52.09186, lon: 5.11891 },
        visitedAt: '2026-03-22T20:00:00+01:00',
        rating: 5,
        visibility: 'private',
      });
      expect(visit.venue.id).not.toBe(firstVenueId);
    });

    it('maakt een nieuwe tent voor dezelfde naam ver weg', async () => {
      const visit = await createVisit('sander', {
        venue: { name: 'Cafe De Zwaan', city: 'Amsterdam', lat: 52.38712, lon: 4.89013 },
        visitedAt: '2026-03-23T20:00:00+01:00',
        rating: 3,
        visibility: 'private',
      });
      expect(visit.venue.id).not.toBe(firstVenueId);
    });

    it('is idempotent op de idempotencyKey uit de offline wachtrij', async () => {
      const body = {
        venue: { name: 'Bar De Kade', city: 'Utrecht', lat: 52.08595, lon: 5.12183 },
        visitedAt: '2026-03-24T22:00:00+01:00',
        rating: 2,
        visibility: 'private',
        idempotencyKey: `test-${randomUUID()}`,
      };
      const first = await request('POST', '/api/visits', { as: 'sander', body });
      const second = await request('POST', '/api/visits', { as: 'sander', body });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
    });

    it('onthoudt een nieuwe naam in de maatjeslijst', async () => {
      const response = await request('GET', '/api/people', { as: 'sander' });
      expect(response.statusCode).toBe(200);
      const names = (response.json().items as Array<{ name: string }>).map((p) => p.name);
      expect(names).toContain('Bram');
    });

    it('filtert op tag en op cijfer', async () => {
      const byTag = await request('GET', '/api/visits?tags=bier', { as: 'sander' });
      expect(byTag.statusCode).toBe(200);
      expect(byTag.json().total).toBe(1);

      const byRating = await request('GET', '/api/visits?ratingMin=5', { as: 'sander' });
      expect(byRating.json().total).toBe(1);
    });
  });

  describe('fotos', () => {
    let visitId = '';
    let photoId = '';

    beforeAll(async () => {
      const visit = await createVisit('sander', {
        venue: { name: 'Fotocafe', city: 'Utrecht', lat: 52.1, lon: 5.13 },
        visitedAt: '2026-04-01T20:00:00+02:00',
        rating: 4,
        visibility: 'private',
      });
      visitId = visit.id;
    });

    it('weigert een bestand dat geen afbeelding is, ondanks een nette naam', async () => {
      const response = await request('POST', `/api/visits/${visitId}/photos`, {
        as: 'sander',
        raw: multipartBody([
          {
            field: 'photo',
            filename: 'foto.jpg',
            contentType: 'image/jpeg',
            data: Buffer.from('PKdit is een zipbestand'),
          },
        ]),
      });
      // De controle gaat op magic bytes, niet op de extensie of de content-type.
      expect(response.statusCode).toBe(415);
    });

    it('neemt een echte jpeg aan, hercodeert naar webp en stript de metadata', async () => {
      const sharp = (await import('sharp')).default;
      // Een jpeg met GPS-coordinaten in de EXIF, precies wat weg moet.
      const jpeg = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#8a5a2b' },
      })
        .withMetadata({
          exif: {
            IFD0: { Copyright: 'test', Make: 'TestToestel' },
            // IFD3 is bij sharp de GPS-IFD. Dit is precies het soort gegeven dat
            // er niet in de opgeslagen foto mag belanden.
            IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
          },
        })
        .jpeg()
        .toBuffer();

      const response = await request('POST', `/api/visits/${visitId}/photos`, {
        as: 'sander',
        raw: multipartBody([
          { field: 'photo', filename: 'kroeg.jpg', contentType: 'image/jpeg', data: jpeg },
        ]),
      });
      expect(response.statusCode, response.body).toBe(201);
      photoId = response.json().items[0].id;

      const fetched = await request('GET', `/api/photos/${photoId}?size=full`, { as: 'sander' });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.headers['content-type']).toContain('image/webp');

      const meta = await sharp(fetched.rawPayload).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
    });

    it('geeft de foto niet aan een andere gebruiker', async () => {
      await registerUser('bram');
      const response = await request('GET', `/api/photos/${photoId}?size=thumb`, { as: 'bram' });
      // Geen 403 maar 404: anders is uit de statuscode af te leiden dat de foto bestaat.
      expect(response.statusCode).toBe(404);
    });

    it('geeft de foto niet zonder sessie', async () => {
      const response = await app.inject({ method: 'GET', url: `/api/photos/${photoId}` });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('anonieme laag en de drempel van drie melders', () => {
    const venue = { name: 'De Dorstige Hert', city: 'Utrecht', lat: 52.09456, lon: 5.11962 };
    const bbox = '5.10,52.08,5.14,52.11';
    let venueId = '';

    const publicVenues = async () => {
      const response = await request('GET', `/api/map/public?bbox=${bbox}&zoom=15`, {
        as: 'sander',
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().items as Array<{ venueId: string; reporterCount: number }>;
    };

    it('publiceert een tent met een melder nog niet', async () => {
      const visit = await createVisit('sander', {
        venue,
        visitedAt: '2026-04-02T20:00:00+02:00',
        description: 'Beste tap van de stad.',
        rating: 5,
        tags: ['terras'],
        visibility: 'public_anonymous',
      });
      venueId = visit.venue.id;

      expect((await publicVenues()).some((v) => v.venueId === venueId)).toBe(false);
    });

    it('publiceert nog niet bij twee melders', async () => {
      await createVisit('bram', {
        venueId,
        visitedAt: '2026-04-05T20:30:00+02:00',
        description: 'Vaste stek geworden.',
        rating: 4,
        visibility: 'public_anonymous',
      });
      expect((await publicVenues()).some((v) => v.venueId === venueId)).toBe(false);
    });

    it('publiceert wel zodra een derde melder erbij komt', async () => {
      await registerUser('joost');
      await createVisit('joost', {
        venueId,
        visitedAt: '2026-04-22T19:00:00+02:00',
        description: 'Personeel weet waar het over gaat.',
        rating: 5,
        visibility: 'public_anonymous',
      });

      const found = (await publicVenues()).find((v) => v.venueId === venueId);
      expect(found).toBeDefined();
      expect(found?.reporterCount).toBe(3);
    });

    it('telt drie meldingen van dezelfde persoon niet als drie melders', async () => {
      const other = { name: 'Het Kleine Glas', city: 'Utrecht', lat: 52.09701, lon: 5.12244 };
      const first = await createVisit('sander', {
        venue: other,
        visitedAt: '2026-04-19T21:15:00+02:00',
        rating: 3,
        visibility: 'public_anonymous',
      });
      for (const day of ['2026-04-20', '2026-04-21']) {
        await createVisit('sander', {
          venueId: first.venue.id,
          visitedAt: `${day}T21:15:00+02:00`,
          rating: 3,
          visibility: 'public_anonymous',
        });
      }
      expect((await publicVenues()).some((v) => v.venueId === first.venue.id)).toBe(false);
    });

    it('levert in de meldingen geen enkel persoonsgegeven uit', async () => {
      const response = await request('GET', `/api/map/venues/${venueId}/reports`, {
        as: 'joost',
      });
      expect(response.statusCode).toBe(200);
      const items = response.json().items as Array<Record<string, unknown>>;
      expect(items.length).toBe(3);

      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual([
          'description',
          'rating',
          'reportId',
          'tags',
          'visitedMonth',
        ]);
        // Alleen jaar en maand, geen dag en geen tijd.
        expect(item.visitedMonth).toMatch(/^\d{4}-\d{2}$/);
      }
    });

    it('kan met de read-only rol de tabel visits niet lezen', async () => {
      // De harde garantie: ook als er in een publiek endpoint een fout zou
      // zitten, weigert de database de query.
      const { publicPool } = await import('../../src/db/client.js');
      await expect(publicPool.query('SELECT user_id FROM visits LIMIT 1')).rejects.toThrow();
      await expect(publicPool.query('SELECT * FROM users LIMIT 1')).rejects.toThrow();
      // En schrijven kan ook niet.
      await expect(
        publicPool.query("UPDATE venues SET name = 'gehackt' WHERE true"),
      ).rejects.toThrow();
    });

    it('haalt een verborgen melding uit de publieke laag', async () => {
      const reportsBefore = await request('GET', `/api/map/venues/${venueId}/reports`, {
        as: 'joost',
      });
      const target = (reportsBefore.json().items as Array<{ reportId: string }>)[0]!;

      const flagged = await request('POST', '/api/moderation/reports', {
        as: 'joost',
        body: { reportId: target.reportId, reason: 'Gaat over het personeel.' },
      });
      expect(flagged.statusCode).toBe(201);
      const contentReportId = flagged.json().contentReportId as string;

      // Een gewone gebruiker mag de wachtrij niet zien.
      const denied = await request('GET', '/api/moderation/queue', { as: 'joost' });
      expect(denied.statusCode).toBe(403);

      // sander is geen moderator, dus de rol wordt hier gezet.
      await appPool.query("UPDATE users SET role = 'moderator' WHERE username = 'sander'");

      const queue = await request('GET', '/api/moderation/queue', { as: 'sander' });
      expect(queue.statusCode).toBe(200);
      const queueItem = (queue.json().items as Array<Record<string, unknown>>)[0]!;
      // De moderator ziet de tekst, maar niet wie hem schreef.
      expect(Object.keys(queueItem)).not.toContain('userId');
      expect(Object.keys(queueItem)).not.toContain('user_id');

      const action = await request('POST', `/api/moderation/reports/${contentReportId}/action`, {
        as: 'sander',
        body: { action: 'hide' },
      });
      expect(action.statusCode).toBe(200);

      const reportsAfter = await request('GET', `/api/map/venues/${venueId}/reports`, {
        as: 'joost',
      });
      const ids = (reportsAfter.json().items as Array<{ reportId: string }>).map(
        (r) => r.reportId,
      );
      expect(ids).not.toContain(target.reportId);

      // Met twee zichtbare meldingen valt de tent onder de drempel en verdwijnt
      // hij ook van de kaart.
      expect((await publicVenues()).some((v) => v.venueId === venueId)).toBe(false);
    });
  });

  describe('kaart, tochten en statistiek', () => {
    it('geeft de eigen tenten binnen de bounding box', async () => {
      const response = await request('GET', '/api/map/mine?bbox=5.10,52.08,5.14,52.11&zoom=15', {
        as: 'sander',
      });
      expect(response.statusCode).toBe(200);
      expect((response.json().items as unknown[]).length).toBeGreaterThan(0);
    });

    it('geeft niets buiten de bounding box', async () => {
      const response = await request('GET', '/api/map/mine?bbox=4.00,50.00,4.10,50.10&zoom=15', {
        as: 'sander',
      });
      expect(response.json().items).toEqual([]);
    });

    it('bouwt een tocht en rekent de afstand tussen de stops uit', async () => {
      const crawl = await request('POST', '/api/crawls', {
        as: 'sander',
        body: { name: 'Binnenstadronde', crawlDate: '2026-03-14', notes: '' },
      });
      expect(crawl.statusCode).toBe(201);
      const crawlId = crawl.json().id as string;

      const visits = await request('GET', '/api/visits?limit=3&sort=visited_asc', {
        as: 'sander',
      });
      const visitIds = (visits.json().items as Array<{ id: string }>).map((v) => v.id);

      const stops = await request('PUT', `/api/crawls/${crawlId}/stops`, {
        as: 'sander',
        body: { visitIds },
      });
      expect(stops.statusCode).toBe(200);

      const detail = await request('GET', `/api/crawls/${crawlId}`, { as: 'sander' });
      expect(detail.statusCode).toBe(200);
      const body = detail.json() as {
        stops: Array<{ position: number; distanceFromPrevM: number | null }>;
        totalDistanceM: number;
      };
      expect(body.stops).toHaveLength(visitIds.length);
      // De eerste stop heeft geen voorganger en dus geen afstand.
      expect(body.stops[0]?.distanceFromPrevM).toBeNull();
      expect(body.stops[1]?.distanceFromPrevM).toBeGreaterThanOrEqual(0);
      expect(body.totalDistanceM).toBeGreaterThanOrEqual(0);
    });

    it('geeft statistiek over de eigen bezoeken', async () => {
      const response = await request('GET', '/api/stats', { as: 'sander' });
      expect(response.statusCode).toBe(200);
      const stats = response.json() as {
        visitCount: number;
        venueCount: number;
        topCompanion: { name: string } | null;
      };
      expect(stats.visitCount).toBeGreaterThan(0);
      expect(stats.venueCount).toBeGreaterThan(0);
      expect(stats.topCompanion?.name).toBe('Bram');
    });

    it('exporteert de eigen data als json', async () => {
      const response = await request('GET', '/api/export/json', { as: 'sander' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        account: { username: string };
        visits: unknown[];
        people: unknown[];
      };
      expect(body.account.username).toBe('sander');
      expect(body.visits.length).toBeGreaterThan(0);
      expect(body.people.length).toBeGreaterThan(0);
    });
  });

  describe('account verwijderen', () => {
    it('wist de gebruiker en alles wat eraan hangt', async () => {
      const username = `wegwerp-${randomUUID().slice(0, 8)}`;
      const user = await registerUser(username);

      const visit = await createVisit(username, {
        venue: { name: 'Tijdelijk Cafe', city: 'Utrecht', lat: 52.11, lon: 5.14 },
        visitedAt: '2026-05-01T20:00:00+02:00',
        rating: 4,
        visibility: 'public_anonymous',
        attendees: [{ name: 'Iemand', remember: true }],
      });

      const before = await appPool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM visits WHERE user_id = $1',
        [user.id],
      );
      expect(before.rows[0]?.n).toBe(1);

      const response = await request('DELETE', '/api/me', {
        as: username,
        body: { confirmUsername: username, password: 'wachtwoord-voor-de-test' },
      });
      expect(response.statusCode, response.body).toBe(200);

      for (const table of ['visits', 'people', 'sessions']) {
        const rows = await appPool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`,
          [user.id],
        );
        expect(rows.rows[0]?.n, table).toBe(0);
      }

      const users = await appPool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM users WHERE id = $1',
        [user.id],
      );
      expect(users.rows[0]?.n).toBe(0);

      // De tent blijft bestaan, want een kroeg is geen persoonsgegeven, maar de
      // verwijzing naar de aanmaker is weg.
      const venues = await appPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM venues WHERE name = 'Tijdelijk Cafe' AND created_by IS NULL",
      );
      expect(venues.rows[0]?.n).toBe(1);

      // De audit blijft, zonder verwijzing naar de verdwenen gebruiker.
      const audit = await appPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'user' AND entity_id = $1 AND actor_user_id IS NULL",
        [user.id],
      );
      expect(audit.rows[0]?.n).toBeGreaterThan(0);

      // En het bezoek is echt weg, niet alleen onzichtbaar.
      const gone = await appPool.query('SELECT 1 FROM visits WHERE id = $1', [visit.id]);
      expect(gone.rowCount).toBe(0);
    });
  });

  describe('migraties', () => {
    it('zijn idempotent en te herhalen', async () => {
      const { runMigrations } = await import('../../src/db/migrate.js');
      await expect(runMigrations()).resolves.toBeUndefined();

      const applied = await appPool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM schema_migrations',
      );
      expect(applied.rows[0]?.n).toBeGreaterThanOrEqual(4);
    });
  });
});
