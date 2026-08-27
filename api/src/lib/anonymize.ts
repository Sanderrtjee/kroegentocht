import { K_ANONYMITY_THRESHOLD } from '@kroegentocht/shared';
import type { PublicMapFeature, PublicReportDto } from '@kroegentocht/shared';

/**
 * Anonimisering van publieke meldingen.
 *
 * De database is de eerste verdedigingslinie: de views in migratie 0004 laten
 * alleen de toegestane kolommen door, en de read-only rol kroeg_public kan de
 * brontabellen niet eens lezen.
 *
 * Deze module is de tweede linie in de applicatie. Elke rij die naar een
 * anonieme consument gaat wordt hier opnieuw opgebouwd uit een expliciete
 * witte lijst van velden. Wat niet in die lijst staat komt er niet door, ook
 * niet als iemand later per ongeluk een kolom aan een view toevoegt.
 */

export { K_ANONYMITY_THRESHOLD };

/** Velden die een anonieme melding mag bevatten. */
export const PUBLIC_REPORT_FIELDS = [
  'reportId',
  'rating',
  'tags',
  'description',
  'visitedMonth',
] as const;

/** Velden die een publiek kaartpunt mag bevatten. */
export const PUBLIC_FEATURE_FIELDS = [
  'venueId',
  'name',
  'city',
  'lat',
  'lon',
  'reportCount',
  'reporterCount',
  'avgRating',
  'topTags',
  'firstMonth',
  'lastMonth',
] as const;

/**
 * Namen die nooit in een anonieme uitvoer mogen voorkomen, in de varianten
 * waarin ze in de codebase bestaan (snake_case uit SQL, camelCase in TypeScript).
 */
export const FORBIDDEN_FIELD_NAMES = new Set([
  'user_id',
  'userid',
  'username',
  'visited_at',
  'visitedat',
  'created_at',
  'createdat',
  'updated_at',
  'updatedat',
  'photos',
  'photo',
  'attendees',
  'people',
  'person_id',
  'personid',
  'free_name',
  'freename',
  'idempotency_key',
  'idempotencykey',
  'moderated_by',
  'moderatedby',
  'ip',
  'email',
]);

export class AnonymityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnonymityViolationError';
  }
}

/**
 * Controleert of een rij velden bevat die naar een persoon kunnen leiden.
 * Bedoeld om te falen tijdens ontwikkeling en in de tests, niet om in productie
 * stil iets te repareren.
 */
export function assertNoPersonalFields(row: Record<string, unknown>, context: string): void {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) {
      throw new AnonymityViolationError(
        `Veld "${key}" hoort niet in anonieme uitvoer (${context}).`,
      );
    }
  }
}

/** Een datum of tijdstempel terugbrengen tot JJJJ-MM. */
export function coarsenToMonth(value: Date | string | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) throw new AnonymityViolationError(`Kan "${value}" niet tot een maand terugbrengen.`);
  return `${match[1]}-${match[2]}`;
}

export function meetsKAnonymity(reporterCount: number): boolean {
  return Number.isFinite(reporterCount) && reporterCount >= K_ANONYMITY_THRESHOLD;
}

function requireNumber(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new AnonymityViolationError(`Veld ${field} is geen getal.`);
  }
  return n;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AnonymityViolationError(`Veld ${field} is geen tekst.`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new AnonymityViolationError(`Veld ${field} is geen lijst met tekst.`);
  }
  return value as string[];
}

/**
 * Bouwt een anonieme melding op uit een databaserij. Alleen de witte lijst gaat
 * mee; de maand wordt bovendien nog een keer teruggebracht tot JJJJ-MM, zodat
 * een eventuele volledige datum uit een toekomstige viewwijziging niet
 * ongemerkt naar buiten glipt.
 */
export function toPublicReport(row: Record<string, unknown>): PublicReportDto {
  assertNoPersonalFields(row, 'melding');
  return {
    reportId: requireString(row.report_id ?? row.reportId, 'reportId'),
    rating: requireNumber(row.rating, 'rating'),
    tags: requireStringArray(row.tags ?? [], 'tags'),
    description: requireString(row.description ?? '', 'description'),
    visitedMonth: coarsenToMonth(
      (row.visited_month ?? row.visitedMonth) as Date | string | null,
    ),
  };
}

/**
 * Bouwt een publiek kaartpunt op. Rijen onder de k-drempel worden geweigerd,
 * ook al filtert de view ze al weg.
 */
export function toPublicMapFeature(row: Record<string, unknown>): PublicMapFeature {
  assertNoPersonalFields(row, 'kaartpunt');
  const reporterCount = requireNumber(row.reporter_count ?? row.reporterCount, 'reporterCount');
  if (!meetsKAnonymity(reporterCount)) {
    throw new AnonymityViolationError(
      `Kaartpunt met ${reporterCount} melder(s) haalt de drempel van ${K_ANONYMITY_THRESHOLD} niet.`,
    );
  }
  const city = row.city;
  return {
    venueId: requireString(row.venue_id ?? row.venueId, 'venueId'),
    name: requireString(row.name, 'name'),
    city: typeof city === 'string' ? city : null,
    lat: requireNumber(row.lat, 'lat'),
    lon: requireNumber(row.lon, 'lon'),
    reportCount: requireNumber(row.report_count ?? row.reportCount, 'reportCount'),
    reporterCount,
    avgRating: requireNumber(row.avg_rating ?? row.avgRating, 'avgRating'),
    topTags: requireStringArray(row.top_tags ?? row.topTags ?? [], 'topTags'),
    firstMonth: coarsenToMonth((row.first_month ?? row.firstMonth) as Date | string | null),
    lastMonth: coarsenToMonth((row.last_month ?? row.lastMonth) as Date | string | null),
  };
}

/**
 * Zeeft een lijst kaartpunten. Rijen die de drempel niet halen worden stil
 * weggelaten in plaats van de hele respons te laten falen, zodat een enkele
 * rare rij de kaart niet onbruikbaar maakt. Andere schendingen gooien wel.
 */
export function toPublicMapFeatures(rows: Array<Record<string, unknown>>): PublicMapFeature[] {
  const out: PublicMapFeature[] = [];
  for (const row of rows) {
    const reporterCount = Number(row.reporter_count ?? row.reporterCount);
    if (!meetsKAnonymity(reporterCount)) continue;
    out.push(toPublicMapFeature(row));
  }
  return out;
}
