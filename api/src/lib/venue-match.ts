import { DEDUPE_RADIUS_M, NAME_SIMILARITY_THRESHOLD } from '@kroegentocht/shared';

/**
 * Deduplicatie van tenten.
 *
 * Werkverdeling tussen database en applicatie:
 *
 * - De database doet het ruimtelijke voorwerk: ST_DWithin op de GIST-index
 *   levert de kandidaten binnen 50 meter, met hun echte geodetische afstand.
 * - De beslissing wordt hier genomen, op genormaliseerde namen en een eigen
 *   implementatie van trigram-similariteit. Daardoor is de hele beslisregel te
 *   testen zonder database, en is hij deterministisch en herleidbaar.
 *
 * pg_trgm blijft nodig voor de index-ondersteunde voorfilter bij het zoeken van
 * tenten op naam; voor de deduplicatiebeslissing is de spatial filter al smal
 * genoeg dat we de kandidaten gewoon in de applicatie kunnen wegen.
 */

/** Woorden die niks onderscheidend zeggen over welke tent het is. */
const GENERIC_PREFIXES = new Set([
  'cafe',
  'eetcafe',
  'grandcafe',
  'grand',
  'bar',
  'pub',
  'kroeg',
  'brasserie',
  'taveerne',
  'taverne',
  'herberg',
]);

/** Lidwoorden en voorzetsels die in kroegnamen willekeurig wel of niet staan. */
const STOPWORDS = new Set(['de', 'het', 'den', 'der', 'the', 'la', 'le', 'les', 'een', 'in']);

/**
 * Zet een tentnaam om naar een vorm die je kunt vergelijken.
 *
 * "Grand Café 't Vosje!" en "cafe Vosje" worden beide "vosje", zodat dezelfde
 * tent onder twee spellingen toch als dezelfde tent wordt herkend.
 */
export function normalizeVenueName(raw: string): string {
  const stripped = raw
    .normalize('NFD')
    // diakritische tekens weg: cafe en café moeten gelijk worden
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    // apostroffen weg zodat 't en t hetzelfde worden
    .replace(/['‘’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  let tokens = stripped.split(' ').filter(Boolean);

  // Alleen aan het begin: "cafe de zwaan" -> "zwaan", maar "de gouden bar"
  // houdt zijn "bar" omdat die daar wel onderscheidend is.
  while (tokens.length > 1 && GENERIC_PREFIXES.has(tokens[0]!)) {
    tokens = tokens.slice(1);
  }

  const withoutStopwords = tokens.filter((t) => !STOPWORDS.has(t));
  // Niet alles weggooien als de naam uitsluitend uit stopwoorden bestaat.
  const result = (withoutStopwords.length > 0 ? withoutStopwords : tokens).join(' ');
  return result.length > 0 ? result : stripped;
}

/**
 * Trigram-set volgens dezelfde regels als pg_trgm: per woord twee spaties
 * ervoor en een erachter, daarna alle vensters van drie tekens.
 */
export function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (const word of value.split(/[^a-z0-9]+/i).filter(Boolean)) {
    const padded = `  ${word.toLowerCase()} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/** Jaccard-similariteit over trigramsets, zoals pg_trgm similarity(). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface VenueCandidate {
  id: string;
  name: string;
  nameNormalized: string;
  /** Geodetische afstand in meters, berekend door PostGIS. */
  distanceM: number;
  osmId?: number | null;
}

export interface VenueMatchQuery {
  name: string;
  osmId?: number | null;
}

export interface VenueMatch {
  candidate: VenueCandidate;
  similarity: number;
  reason: 'osm_id' | 'exact_normalized_name' | 'similar_name';
}

/**
 * Kiest de bestaande tent waaraan gekoppeld moet worden, of null als er geen
 * goede kandidaat is en er dus een nieuwe tent aangemaakt mag worden.
 *
 * Volgorde van zekerheid:
 *   1. gelijk osm_id, dan is het aantoonbaar dezelfde tent
 *   2. gelijke genormaliseerde naam binnen de radius
 *   3. voldoende gelijkende naam binnen de radius
 *
 * Bij gelijke score wint de dichtstbijzijnde.
 */
export function chooseVenueMatch(
  query: VenueMatchQuery,
  candidates: readonly VenueCandidate[],
  options: { radiusM?: number; similarityThreshold?: number } = {},
): VenueMatch | null {
  const radiusM = options.radiusM ?? DEDUPE_RADIUS_M;
  const threshold = options.similarityThreshold ?? NAME_SIMILARITY_THRESHOLD;
  const normalizedQuery = normalizeVenueName(query.name);

  if (query.osmId != null) {
    const byOsm = candidates.find((c) => c.osmId != null && c.osmId === query.osmId);
    if (byOsm) {
      return {
        candidate: byOsm,
        similarity: trigramSimilarity(normalizedQuery, byOsm.nameNormalized),
        reason: 'osm_id',
      };
    }
  }

  const scored = candidates
    .filter((c) => c.distanceM <= radiusM)
    .map((c) => {
      const exact = c.nameNormalized === normalizedQuery;
      return {
        candidate: c,
        similarity: exact ? 1 : trigramSimilarity(normalizedQuery, c.nameNormalized),
        exact,
      };
    })
    .filter((s) => s.exact || s.similarity >= threshold)
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return a.candidate.distanceM - b.candidate.distanceM;
    });

  const best = scored[0];
  if (!best) return null;

  return {
    candidate: best.candidate,
    similarity: best.similarity,
    reason: best.exact ? 'exact_normalized_name' : 'similar_name',
  };
}

/**
 * Hemelsbrede afstand in meters. PostGIS is gezaghebbend voor afstanden die de
 * database in gaan; deze variant is er voor de frontend en de tests.
 */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_008.8; // gemiddelde aardradius, gelijk aan de sferoide van PostGIS
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Sleutel om gelijktijdige aanmaak in hetzelfde gebied te serialiseren met een
 * advisory lock.
 *
 * Het raster is 0.01 graad, ongeveer 1,1 kilometer, dus twintig keer ruimer dan
 * de deduplicatieradius. Dat is opzet: bij een fijner raster kunnen twee inserts
 * van dezelfde tent net aan weerszijden van een rastergrens vallen en dan
 * serialiseert de lock niets. Venues aanmaken is zeldzaam, dus de extra
 * contentie binnen een hokje kost niets.
 */
export function venueLockKey(lat: number, lon: number): number {
  const gridLat = Math.round(lat * 100); // -9000 .. 9000
  const gridLon = Math.round(lon * 100); // -18000 .. 18000
  return (gridLat + 9_000) * 40_000 + (gridLon + 18_000);
}
