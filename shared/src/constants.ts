/**
 * Constanten die de API en de frontend delen. Waarden die ook in SQL voorkomen
 * staan hier als enige bron in TypeScript; de plek in SQL verwijst er in een
 * commentaar naar terug.
 */

export const ROLES = ['user', 'moderator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const VISIBILITIES = ['private', 'friends', 'public_anonymous'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Aantal onafhankelijke melders dat nodig is voordat een tent en zijn anonieme
 * meldingen publiek zichtbaar worden. Gespiegeld in
 * db/migrations/0004_public_views_and_role.sql.
 */
export const K_ANONYMITY_THRESHOLD = 3;

/** Radius waarbinnen een bestaande tent als dezelfde tent geldt. */
export const DEDUPE_RADIUS_M = 50;

/**
 * Ondergrens voor trigram-similariteit van genormaliseerde namen binnen die
 * radius. Empirisch gekozen: "cafe de zwaan" vs "de zwaan" haalt dit wel,
 * "de zwaan" vs "het anker" niet.
 */
export const NAME_SIMILARITY_THRESHOLD = 0.35;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_VISIT = 8;

/** Toegestane invoerformaten. Controle gebeurt op magic bytes, niet op extensie. */
export const ALLOWED_UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Alle uploads worden hiernaar hergecodeerd. */
export const OUTPUT_IMAGE_FORMAT = 'webp' as const;
export const FULL_IMAGE_MAX_EDGE = 2000;
export const THUMB_IMAGE_MAX_EDGE = 400;

export const SESSION_COOKIE_NAME = 'kt_session';
export const SESSION_TTL_DAYS = 30;

export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 19;

export const PRICE_LABELS: Record<number, string> = {
  1: 'Goedkoop',
  2: 'Normaal',
  3: 'Duur',
  4: 'Overval',
};

export const OSM_ATTRIBUTION =
  'Kaartdata &copy; OpenStreetMap-bijdragers, ODbL. Tiles via eigen cachende proxy.';
