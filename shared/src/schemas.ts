import { z } from 'zod';
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAX_PHOTOS_PER_VISIT,
  VISIBILITIES,
} from './constants.js';

/* ------------------------------------------------------------------ bouwstenen */

export const uuidSchema = z.string().uuid();

/**
 * Bewust geen z.iso.datetime(): Date.parse plus een vormcheck werkt in zowel
 * zod 3 als 4 en accepteert de tijdstempels die de browser produceert.
 */
export const isoDateTimeSchema = z
  .string()
  .max(40)
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)),
    { message: 'Ongeldige ISO-tijdstempel' },
  );

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Verwacht formaat JJJJ-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Ongeldige datum' });

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/** Tags worden genormaliseerd naar kleine letters zonder dubbele spaties. */
export const tagSchema = z
  .string()
  .min(1)
  .max(30)
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
  .refine((s) => s.length > 0, { message: 'Lege tag' });

export const tagsSchema = z.array(tagSchema).max(12);

/* ----------------------------------------------------------------------- auth */

export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Alleen letters, cijfers, punt, liggend streepje en min');

export const passwordSchema = z.string().min(12).max(200);

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  inviteCode: z.string().min(1).max(200),
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  confirmUsername: usernameSchema,
  password: z.string().min(1).max(200),
});

/* --------------------------------------------------------------------- venues */

export const venueInputSchema = z.object({
  name: z.string().min(1).max(200),
  street: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  lat: latitudeSchema,
  lon: longitudeSchema,
  osmId: z.number().int().positive().optional(),
});

export const venueResolveSchema = venueInputSchema;

export const venueSearchQuerySchema = z.object({
  q: z.string().min(1).max(120).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().int().min(1).max(20000).default(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/* --------------------------------------------------------------------- visits */

export const attendeeInputSchema = z
  .object({
    personId: uuidSchema.optional(),
    name: z.string().min(1).max(80).optional(),
    /**
     * Bij true komt een nieuwe naam in de eigen maatjeslijst te staan, zodat je
     * hem volgende keer kunt aanklikken. Bij false wordt de naam alleen als
     * vrije tekst aan dit ene bezoek gehangen.
     */
    remember: z.boolean().default(true),
  })
  .refine((a) => Boolean(a.personId) || Boolean(a.name), {
    message: 'Geef personId of name mee',
  });

export const visitCreateSchema = z
  .object({
    venueId: uuidSchema.optional(),
    venue: venueInputSchema.optional(),
    visitedAt: isoDateTimeSchema,
    description: z.string().max(4000).default(''),
    rating: z.coerce.number().int().min(1).max(5),
    priceIndication: z.coerce.number().int().min(1).max(4).nullish(),
    tags: tagsSchema.default([]),
    visibility: z.enum(VISIBILITIES).default('private'),
    attendees: z.array(attendeeInputSchema).max(30).default([]),
    crawlId: uuidSchema.optional(),
    /** Maakt herhaald versturen uit de offline wachtrij veilig. */
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .refine((d) => Boolean(d.venueId) !== Boolean(d.venue), {
    message: 'Geef precies een van venueId of venue mee',
  });

export const visitUpdateSchema = z.object({
  visitedAt: isoDateTimeSchema.optional(),
  description: z.string().max(4000).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  priceIndication: z.coerce.number().int().min(1).max(4).nullish(),
  tags: tagsSchema.optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  attendees: z.array(attendeeInputSchema).max(30).optional(),
});

export const visitListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  ratingMin: z.coerce.number().int().min(1).max(5).optional(),
  ratingMax: z.coerce.number().int().min(1).max(5).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  city: z.string().min(1).max(120).optional(),
  /** Kommagescheiden lijst; alle tags moeten voorkomen. */
  tags: z
    .string()
    .max(200)
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : undefined,
    ),
  personId: uuidSchema.optional(),
  crawlId: uuidSchema.optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  q: z.string().min(1).max(120).optional(),
  sort: z.enum(['visited_desc', 'visited_asc', 'rating_desc']).default('visited_desc'),
});

export const photoOrderSchema = z.object({
  photoIds: z.array(uuidSchema).min(1).max(MAX_PHOTOS_PER_VISIT),
});

export const photoSizeQuerySchema = z.object({
  size: z.enum(['thumb', 'full']).default('thumb'),
});

/* --------------------------------------------------------------------- people */

export const personCreateSchema = z.object({
  name: z.string().min(1).max(80),
});

export const personUpdateSchema = personCreateSchema;

/* --------------------------------------------------------------------- crawls */

export const crawlCreateSchema = z.object({
  name: z.string().min(1).max(120),
  crawlDate: isoDateSchema,
  notes: z.string().max(4000).default(''),
});

export const crawlUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  crawlDate: isoDateSchema.optional(),
  notes: z.string().max(4000).optional(),
});

/** Volledige, geordende lijst stops. De afstanden worden serverside herrekend. */
export const crawlStopsSchema = z.object({
  visitIds: z.array(uuidSchema).max(50),
});

/* ------------------------------------------------------------------ vrienden */

export const friendRequestSchema = z.object({
  username: usernameSchema,
});

export const friendRespondSchema = z.object({
  accept: z.boolean(),
});

/* ------------------------------------------------------------------------ map */

/** bbox=minLon,minLat,maxLon,maxLat */
export const bboxSchema = z
  .string()
  .max(120)
  .transform((raw, ctx) => {
    const parts = raw.split(',').map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: 'custom', message: 'bbox verwacht 4 getallen' });
      return z.NEVER;
    }
    const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
    if (minLon >= maxLon || minLat >= maxLat) {
      ctx.addIssue({ code: 'custom', message: 'bbox is leeg of omgedraaid' });
      return z.NEVER;
    }
    if (
      minLat < -90 || maxLat > 90 ||
      minLon < -180 || maxLon > 180
    ) {
      ctx.addIssue({ code: 'custom', message: 'bbox buiten bereik' });
      return z.NEVER;
    }
    return { minLon, minLat, maxLon, maxLat };
  });

export const mapBboxQuerySchema = z.object({
  bbox: bboxSchema,
  zoom: z.coerce.number().int().min(MAP_MIN_ZOOM).max(MAP_MAX_ZOOM).default(14),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
});

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(10).max(20000).default(1000),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  layer: z.enum(['mine', 'public']).default('public'),
});

export const heatmapQuerySchema = z.object({
  bbox: bboxSchema,
  zoom: z.coerce.number().int().min(MAP_MIN_ZOOM).max(MAP_MAX_ZOOM).default(12),
});

export const venueReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/* ---------------------------------------------------------------- moderatie */

export const contentReportCreateSchema = z.object({
  reportId: uuidSchema,
  reason: z.string().min(1).max(500),
});

export const moderationActionSchema = z.object({
  action: z.enum(['hide', 'unhide', 'dismiss']),
});

/* ------------------------------------------------------------------- geocode */

export const geocodeQuerySchema = z.object({
  q: z.string().min(3).max(160),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

/* --------------------------------------------------------------------- tiles */

export const tileParamsSchema = z.object({
  z: z.coerce.number().int().min(MAP_MIN_ZOOM).max(MAP_MAX_ZOOM),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

/* --------------------------------------------------------------------- types */

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VenueInput = z.infer<typeof venueInputSchema>;
export type VisitCreateInput = z.infer<typeof visitCreateSchema>;
export type VisitUpdateInput = z.infer<typeof visitUpdateSchema>;
export type VisitListQuery = z.infer<typeof visitListQuerySchema>;
export type CrawlCreateInput = z.infer<typeof crawlCreateSchema>;
export type Bbox = z.infer<typeof bboxSchema>;
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
