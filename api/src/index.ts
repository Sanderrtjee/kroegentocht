import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closePools } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { pruneExpiredSessions } from './lib/session.js';
import { ensureMediaRoot } from './lib/storage.js';

/**
 * Startvolgorde: eerst migreren, dan pas luisteren. Een container die opstart
 * terwijl een andere nog migreert wacht in de advisory lock; hij komt dus later
 * omhoog in plaats van tegen een half schema aan te praten.
 */
async function main(): Promise<void> {
  await runMigrations();
  await ensureMediaRoot();
  await mkdir(env.TILE_CACHE_ROOT, { recursive: true });

  const app = await buildApp();

  // Verlopen sessies opruimen: een keer bij het starten en daarna elke zes uur.
  void pruneExpiredSessions().then((n) => {
    if (n > 0) app.log.info({ removed: n }, 'verlopen sessies opgeruimd');
  });
  const pruneTimer = setInterval(
    () => {
      void pruneExpiredSessions().catch((err: unknown) =>
        app.log.error({ err }, 'opruimen van sessies mislukt'),
      );
    },
    6 * 60 * 60 * 1000,
  );
  pruneTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'afsluiten');
    clearInterval(pruneTimer);
    try {
      await app.close();
    } finally {
      await closePools();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(
    `api luistert op http://${env.HOST}:${env.PORT} (plain http, TLS bij de proxy)`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`opstarten mislukt: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
