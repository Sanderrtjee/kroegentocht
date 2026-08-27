import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appPool, closePools } from './client.js';
import { hashPassword } from '../lib/password.js';
import { normalizeVenueName } from '../lib/venue-match.js';
import { recomputeCrawl } from '../lib/crawl-utils.js';

/**
 * Testdata.
 *
 * De set is zo gekozen dat je de bijzondere gevallen kunt zien zonder zelf te
 * hoeven prikken:
 *
 * - "De Dorstige Hert" heeft drie melders en staat dus wel op de anonieme laag.
 * - "Het Kleine Glas" heeft twee melders en staat er dus niet op; daarmee is de
 *   k-drempel met het oog te controleren.
 * - "Cafe De Zwaan" en "Grand Cafe de Zwaan" liggen dertig meter van elkaar en
 *   zijn opzettelijk dezelfde tent, om de deduplicatie te demonstreren.
 * - Er is een tocht met vier stops zodat de tijdlijn en de totaalafstand gevuld zijn.
 *
 * De namen zijn verzonnen; de coordinaten liggen in Utrecht zodat de kaart ergens
 * op uitkomt.
 */

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'kroegentocht-demo-1234';

interface SeedVenue {
  key: string;
  name: string;
  street: string;
  city: string;
  lat: number;
  lon: number;
}

const VENUES: SeedVenue[] = [
  { key: 'zwaan', name: 'Cafe De Zwaan', street: 'Oudegracht 121', city: 'Utrecht', lat: 52.09183, lon: 5.11889 },
  { key: 'hert', name: 'De Dorstige Hert', street: 'Neude 14', city: 'Utrecht', lat: 52.09456, lon: 5.11962 },
  { key: 'glas', name: 'Het Kleine Glas', street: 'Voorstraat 68', city: 'Utrecht', lat: 52.09701, lon: 5.12244 },
  { key: 'anker', name: 'Eetcafe Het Anker', street: 'Nobelstraat 3', city: 'Utrecht', lat: 52.09312, lon: 5.12571 },
  { key: 'vosje', name: "Grand Cafe 't Vosje", street: 'Janskerkhof 20', city: 'Utrecht', lat: 52.09285, lon: 5.12283 },
  { key: 'kade', name: 'Bar De Kade', street: 'Twijnstraat 4', city: 'Utrecht', lat: 52.08595, lon: 5.12183 },
  { key: 'haven', name: 'Havenkroeg Noord', street: 'Havenweg 9', city: 'Amsterdam', lat: 52.38712, lon: 4.89013 },
];

interface SeedUser {
  username: string;
  role: 'user' | 'moderator' | 'admin';
}

const USERS: SeedUser[] = [
  { username: 'sander', role: 'admin' },
  { username: 'bram', role: 'user' },
  { username: 'joost', role: 'user' },
  { username: 'marieke', role: 'moderator' },
];

function log(message: string): void {
  process.stdout.write(`[seed] ${message}\n`);
}

async function tableIsEmpty(table: string): Promise<boolean> {
  const result = await appPool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return (result.rows[0]?.n ?? 0) === 0;
}

export async function seed(): Promise<void> {
  const force = process.env.SEED_FORCE === '1';

  if (!(await tableIsEmpty('users'))) {
    if (!force) {
      log('er staan al gebruikers in de database; niets gedaan. Gebruik SEED_FORCE=1 om te wissen.');
      return;
    }
    log('SEED_FORCE=1, bestaande data wissen');
    // venues staan los van users, dus die moeten er expliciet bij.
    await appPool.query('TRUNCATE users, venues, audit_log RESTART IDENTITY CASCADE');
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const inserted = await appPool.query<{ id: string }>(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [user.username, passwordHash, user.role],
    );
    userIds.set(user.username, inserted.rows[0]!.id);
  }
  log(`${USERS.length} gebruikers aangemaakt, wachtwoord: ${SEED_PASSWORD}`);

  const venueIds = new Map<string, string>();
  for (const venue of VENUES) {
    const inserted = await appPool.query<{ id: string }>(
      `INSERT INTO venues (name, name_normalized, street, city, country, location, created_by)
       VALUES ($1, $2, $3, $4, 'Nederland', ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7)
       RETURNING id`,
      [
        venue.name,
        normalizeVenueName(venue.name),
        venue.street,
        venue.city,
        venue.lon,
        venue.lat,
        userIds.get('sander')!,
      ],
    );
    venueIds.set(venue.key, inserted.rows[0]!.id);
  }
  log(`${VENUES.length} tenten aangemaakt`);

  const sander = userIds.get('sander')!;
  const bram = userIds.get('bram')!;
  const joost = userIds.get('joost')!;
  const marieke = userIds.get('marieke')!;

  // Maatjes van sander, zodat de aanwezigenkiezer gevuld is.
  const peopleIds = new Map<string, string>();
  for (const name of ['Bram', 'Joost', 'Marieke', 'Tim', 'Sanne']) {
    const inserted = await appPool.query<{ id: string }>(
      'INSERT INTO people (user_id, name) VALUES ($1, $2) RETURNING id',
      [sander, name],
    );
    peopleIds.set(name, inserted.rows[0]!.id);
  }

  await appPool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status, accepted_at)
     VALUES ($1, $2, 'accepted', now()), ($1, $3, 'accepted', now()), ($4, $1, 'pending', NULL)`,
    [sander, bram, joost, marieke],
  );

  interface SeedVisit {
    user: string;
    venue: string;
    visitedAt: string;
    rating: number;
    visibility: 'private' | 'friends' | 'public_anonymous';
    description: string;
    tags: string[];
    price?: number;
    attendees?: string[];
  }

  const visits: SeedVisit[] = [
    // Tocht van sander, vier stops op een avond.
    { user: sander, venue: 'zwaan', visitedAt: '2026-03-14T19:30:00+01:00', rating: 4, visibility: 'public_anonymous', description: 'Prima begin, bediening kende ons na tien minuten.', tags: ['bier', 'gezellig'], price: 2, attendees: ['Bram', 'Joost'] },
    { user: sander, venue: 'vosje', visitedAt: '2026-03-14T21:00:00+01:00', rating: 3, visibility: 'public_anonymous', description: 'Te vol, muziek te hard, bier prima.', tags: ['druk'], price: 3, attendees: ['Bram', 'Joost', 'Marieke'] },
    { user: sander, venue: 'anker', visitedAt: '2026-03-14T22:30:00+01:00', rating: 5, visibility: 'friends', description: 'Bitterballen op het huis omdat we de laatste waren.', tags: ['eten', 'bier'], price: 2, attendees: ['Bram', 'Joost', 'Marieke'] },
    { user: sander, venue: 'kade', visitedAt: '2026-03-15T00:15:00+01:00', rating: 2, visibility: 'private', description: 'Slecht idee op dit tijdstip.', tags: ['nachtzaak'], price: 4, attendees: ['Bram'] },

    // Losse bezoeken van sander.
    { user: sander, venue: 'hert', visitedAt: '2026-04-02T20:00:00+02:00', rating: 5, visibility: 'public_anonymous', description: 'Beste tap van de stad, terras in de zon.', tags: ['terras', 'bier'], price: 2, attendees: ['Sanne'] },
    { user: sander, venue: 'glas', visitedAt: '2026-04-19T21:15:00+02:00', rating: 3, visibility: 'public_anonymous', description: 'Klein en krap, maar de jukebox maakt veel goed.', tags: ['klein'], price: 2, attendees: ['Tim'] },
    { user: sander, venue: 'haven', visitedAt: '2026-05-08T18:45:00+02:00', rating: 4, visibility: 'friends', description: 'Uitzicht op het water, prijzen op het water.', tags: ['uitzicht'], price: 3 },

    // Drie verschillende melders op 'hert': die tent haalt de k-drempel.
    { user: bram, venue: 'hert', visitedAt: '2026-04-05T20:30:00+02:00', rating: 4, visibility: 'public_anonymous', description: 'Vaste stek geworden.', tags: ['bier', 'terras'], price: 2 },
    { user: joost, venue: 'hert', visitedAt: '2026-04-22T19:00:00+02:00', rating: 5, visibility: 'public_anonymous', description: 'Personeel weet waar het over gaat.', tags: ['bier'], price: 2 },
    { user: marieke, venue: 'hert', visitedAt: '2026-05-11T21:45:00+02:00', rating: 4, visibility: 'public_anonymous', description: 'Rustig op een woensdag, precies goed.', tags: ['rustig'], price: 2 },

    // Twee melders op 'glas': blijft onder de drempel en dus onzichtbaar.
    { user: bram, venue: 'glas', visitedAt: '2026-04-25T22:00:00+02:00', rating: 2, visibility: 'public_anonymous', description: 'Rokerig gevoel zonder dat er iemand rookt.', tags: ['klein'], price: 2 },

    // Drie melders op 'zwaan'.
    { user: bram, venue: 'zwaan', visitedAt: '2026-03-28T20:00:00+01:00', rating: 4, visibility: 'public_anonymous', description: 'Degelijk, nooit een misser.', tags: ['bier'], price: 2 },
    { user: joost, venue: 'zwaan', visitedAt: '2026-05-02T19:30:00+02:00', rating: 3, visibility: 'public_anonymous', description: 'Prima, iets duurder geworden.', tags: ['bier'], price: 3 },
  ];

  const insertedVisitIds: string[] = [];
  for (const visit of visits) {
    const inserted = await appPool.query<{ id: string }>(
      `INSERT INTO visits (user_id, venue_id, visited_at, description, rating, price_indication, tags, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
       RETURNING id`,
      [
        visit.user,
        venueIds.get(visit.venue)!,
        visit.visitedAt,
        visit.description,
        visit.rating,
        visit.price ?? null,
        visit.tags,
        visit.visibility,
      ],
    );
    const visitId = inserted.rows[0]!.id;
    insertedVisitIds.push(visitId);

    if (visit.user === sander) {
      for (const name of visit.attendees ?? []) {
        await appPool.query(
          'INSERT INTO visit_attendees (visit_id, person_id) VALUES ($1, $2)',
          [visitId, peopleIds.get(name)!],
        );
      }
    }
  }
  log(`${visits.length} bezoeken aangemaakt`);

  // De tocht van 14 maart: de eerste vier bezoeken van sander.
  const crawl = await appPool.query<{ id: string }>(
    `INSERT INTO crawls (user_id, name, crawl_date, notes)
     VALUES ($1, 'Binnenstadronde', '2026-03-14', 'Begonnen bij de Zwaan, geeindigd waar we niet hadden moeten eindigen.')
     RETURNING id`,
    [sander],
  );
  const crawlId = crawl.rows[0]!.id;
  const client = await appPool.connect();
  try {
    for (const [index, visitId] of insertedVisitIds.slice(0, 4).entries()) {
      await client.query(
        'INSERT INTO crawl_stops (crawl_id, visit_id, position) VALUES ($1, $2, $3)',
        [crawlId, visitId, index],
      );
    }
    await recomputeCrawl(client, crawlId);
  } finally {
    client.release();
  }

  // Een openstaande melding zodat de moderatiewachtrij niet leeg is.
  const reportable = await appPool.query<{ id: string }>(
    `SELECT id FROM visits WHERE visibility = 'public_anonymous' AND user_id = $1 LIMIT 1`,
    [bram],
  );
  if (reportable.rows[0]) {
    await appPool.query(
      `INSERT INTO content_reports (visit_id, reporter_user_id, reason)
       VALUES ($1, $2, 'Deze tekst gaat over het personeel en niet over de tent.')`,
      [reportable.rows[0].id, sander],
    );
  }

  const check = await appPool.query<{ venue_id: string; reporter_count: number }>(
    'SELECT venue_id, reporter_count FROM public_venue_aggregates ORDER BY reporter_count DESC',
  );
  log(
    `publieke laag bevat ${check.rowCount} tent(en) boven de drempel: ${check.rows
      .map((r) => `${r.venue_id.slice(0, 8)}=${r.reporter_count}`)
      .join(', ')}`,
  );
  log('klaar');
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  seed()
    .then(() => closePools())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`[seed] MISLUKT: ${(err as Error).stack ?? String(err)}\n`);
      process.exit(1);
    });
}
