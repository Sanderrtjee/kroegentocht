import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { env } from '../config/env.js';

/**
 * Migratierunner.
 *
 * Eigenschappen die nodig zijn omdat meerdere api-containers tegelijk kunnen
 * starten:
 *
 * - Idempotent: alleen niet-toegepaste bestanden worden uitgevoerd.
 * - Vergrendeld: een session-level advisory lock zorgt ervoor dat een tweede
 *   starter wacht in plaats van dezelfde migratie dubbel uit te voeren.
 * - Controleerbaar: van elk toegepast bestand wordt de sha256 bewaard. Wijzigt
 *   een al toegepaste migratie, dan stopt de runner met een foutmelding in
 *   plaats van stil af te wijken van wat er in de database staat.
 *
 * Elke migratie loopt in een eigen transactie, dus een halve migratie kan niet
 * blijven staan.
 */

const ADVISORY_LOCK_KEY = 724193001;

const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL('../../../db/migrations', import.meta.url));

interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const out: MigrationFile[] = [];
  for (const filename of entries) {
    const version = filename.split('_')[0];
    if (!version || !/^\d{4}$/.test(version)) {
      throw new Error(
        `Migratiebestand ${filename} begint niet met een viercijferig versienummer.`,
      );
    }
    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    out.push({
      version,
      filename,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }

  const seen = new Set<string>();
  for (const m of out) {
    if (seen.has(m.version)) throw new Error(`Dubbel versienummer ${m.version}.`);
    seen.add(m.version);
  }
  return out;
}

function log(msg: string): void {
  process.stdout.write(`[migrate] ${msg}\n`);
}

/**
 * Zorgt dat de rol uit DATABASE_PUBLIC_URL bestaat, kan inloggen met het
 * wachtwoord uit die URL, alleen kan lezen, en lid is van kroeg_public zodat hij
 * de publicatieviews mag selecteren.
 *
 * Het wachtwoord wordt nooit in een SQL-string geplakt door ons zelf: we laten
 * Postgres de DDL opbouwen met format(%I, %L), zodat quoting daar gebeurt.
 */
async function ensurePublicRole(client: pg.PoolClient | pg.Client): Promise<void> {
  const url = new URL(env.DATABASE_PUBLIC_URL);
  const roleName = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  if (!roleName) throw new Error('DATABASE_PUBLIC_URL mist een gebruikersnaam.');
  if (!password) throw new Error('DATABASE_PUBLIC_URL mist een wachtwoord.');

  const built = await client.query<{ create_sql: string; alter_sql: string }>(
    `SELECT format('CREATE ROLE %I NOLOGIN', $1::text)             AS create_sql,
            format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS alter_sql`,
    [roleName, password],
  );
  const { create_sql, alter_sql } = built.rows[0]!;

  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
  if (exists.rowCount === 0) {
    await client.query(create_sql);
    log(`rol ${roleName} aangemaakt`);
  }
  await client.query(alter_sql);

  const readOnly = await client.query<{ sql: string }>(
    `SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', $1::text) AS sql`,
    [roleName],
  );
  await client.query(readOnly.rows[0]!.sql);

  if (roleName !== 'kroeg_public') {
    const grant = await client.query<{ sql: string }>(
      `SELECT format('GRANT kroeg_public TO %I', $1::text) AS sql`,
      [roleName],
    );
    await client.query(grant.rows[0]!.sql);
  }

  // Sluit uit dat de publieke rol per ongeluk toch bij de brontabellen kan.
  const revokes = await client.query<{ sql: string }>(
    `SELECT format('REVOKE ALL ON %I FROM %I', t, $1::text) AS sql
     FROM unnest(ARRAY['visits','users','visit_photos','visit_attendees','people',
                       'sessions','audit_log','friendships','content_reports']) AS t`,
    [roleName],
  );
  for (const row of revokes.rows) {
    await client.query(row.sql);
  }

  log(`rol ${roleName} is read-only en mag alleen de publicatieviews lezen`);
}

export async function runMigrations(): Promise<void> {
  const migrations = await loadMigrations();
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    application_name: 'kroegentocht-migrate',
  });
  await client.connect();

  try {
    log(`advisory lock ${ADVISORY_LOCK_KEY} aanvragen`);
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        filename   text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ version: string; filename: string; checksum: string }>(
      'SELECT version, filename, checksum FROM schema_migrations',
    );
    const appliedByVersion = new Map(applied.rows.map((r) => [r.version, r]));

    for (const m of migrations) {
      const previous = appliedByVersion.get(m.version);
      if (previous) {
        if (previous.checksum !== m.checksum) {
          throw new Error(
            `Migratie ${m.filename} is gewijzigd nadat hij was toegepast ` +
              `(verwacht ${previous.checksum.slice(0, 12)}, gevonden ${m.checksum.slice(0, 12)}). ` +
              'Maak een nieuwe migratie in plaats van een bestaande aan te passen.',
          );
        }
        continue;
      }

      log(`toepassen ${m.filename}`);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
          [m.version, m.filename, m.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migratie ${m.filename} faalde: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }

    await ensurePublicRole(client);
    log(`klaar, ${migrations.length} migratie(s) bekend`);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      /* verbinding al weg; de lock valt vrij bij het sluiten van de sessie */
    }
    await client.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  runMigrations().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`[migrate] MISLUKT: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
