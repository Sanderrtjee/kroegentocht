import { z } from 'zod';

/**
 * Alle configuratie komt uit omgevingsvariabelen en wordt hier eenmalig
 * gevalideerd. De applicatie start niet als er iets ontbreekt of onzinnig is;
 * dat is beter dan halverwege een request ontdekken dat een geheim leeg is.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
  });

const csv = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((s) =>
      s && s.trim().length > 0
        ? s.split(',').map((p) => p.trim()).filter(Boolean)
        : fallback,
    );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Volledige rechten: de applicatie-eigenaar van het schema. */
  DATABASE_URL: z.string().min(1),
  /**
   * Read-only rol kroeg_public. Wordt uitsluitend gebruikt voor de anonieme
   * publicatielaag en kan de tabel visits niet lezen.
   */
  DATABASE_PUBLIC_URL: z.string().min(1),
  DB_MAX_CONNECTIONS: z.coerce.number().int().min(2).max(50).default(10),
  DB_PUBLIC_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(4),

  /** Ondertekent sessiecookies en de dagelijkse pepper voor gehashte IP-adressen. */
  SESSION_SECRET: z.string().min(32),

  REGISTRATION_ENABLED: boolish.default(true),
  /** Registratie zit standaard achter deze code. */
  INVITE_CODE: z.string().min(6),

  /** Cookie Secure-vlag. Achter Nginx Proxy Manager met TLS hoort dit true te zijn. */
  COOKIE_SECURE: boolish.default(true),

  MEDIA_ROOT: z.string().default('/var/lib/kroegentocht/media'),
  TILE_CACHE_ROOT: z.string().default('/var/lib/kroegentocht/tiles'),
  TILE_CACHE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TILE_UPSTREAM_TEMPLATE: z
    .string()
    .default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  NOMINATIM_BASE_URL: z.string().default('https://nominatim.openstreetmap.org'),

  /**
   * Wordt in de User-Agent naar OpenStreetMap en Nominatim gezet. Hun
   * gebruiksbeleid eist een identificeerbare applicatie met contactadres.
   */
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  CONTACT_EMAIL: z.string().min(3),

  /**
   * Alleen vanaf deze bereiken worden X-Forwarded-* headers vertrouwd. Standaard
   * de RFC1918-bereiken plus loopback, wat overeenkomt met een Docker-netwerk
   * met Nginx Proxy Manager ervoor.
   */
  TRUSTED_PROXY_CIDRS: csv([
    '127.0.0.1',
    '::1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    'fc00::/7',
  ]),

  /** Pad naar de gebouwde frontend. Leeg laten betekent: niets uitserveren. */
  WEB_DIST_PATH: z.string().default(''),

  RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_REGISTER_PER_HOUR: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_UPLOAD_PER_HOUR: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(10).default(600),
  RATE_LIMIT_GEOCODE_PER_MINUTE: z.coerce.number().int().min(1).default(20),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Ongeldige omgevingsvariabelen:\n${lines.join('\n')}`);
  }
  /**
   * Onbeveiligde cookies in productie is een slecht idee, maar geen reden om te
   * weigeren op te starten. Dat was het eerst wel, en dat bleek in de praktijk
   * verkeerd: het maakte het onmogelijk om de applicatie eerst op het eigen
   * netwerk te controleren voordat je hem achter een proxy met TLS zet. Dat is
   * precies de volgorde die je wil aanhouden.
   *
   * Dus: een waarschuwing die je niet over het hoofd ziet, en verder starten.
   */
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    process.stderr.write(
      [
        '',
        '  ##############################################################',
        '  #  LET OP: COOKIE_SECURE staat uit terwijl NODE_ENV op       #',
        '  #  production staat.                                         #',
        '  #                                                            #',
        '  #  De sessiecookie gaat nu ook over onbeveiligd http mee.     #',
        '  #  Op een eigen netwerk om even te kijken of alles werkt is   #',
        '  #  dat te overzien. Zet dit weer aan zodra er TLS voor staat, #',
        '  #  anders is een sessie mee te lezen door iedereen die het    #',
        '  #  netwerkverkeer kan zien.                                   #',
        '  ##############################################################',
        '',
      ].join('\n'),
    );
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
