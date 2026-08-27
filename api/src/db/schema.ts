import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  pgView,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle-schema voor typed queries.
 *
 * De migraties in db/migrations zijn gezaghebbend voor de vorm van de database:
 * PostGIS-kolommen, generated columns, views en rolrechten laten zich niet goed
 * uit een ORM-schema genereren. Dit bestand beschrijft dezelfde structuur zodat
 * queries typecheckt kunnen worden. Wijzig altijd eerst de migratie.
 */

const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * geography(Point,4326). Nooit direct selecteren: lees de coordinaten uit met
 * ST_Y/ST_X in een sql-expressie, en schrijf met ST_SetSRID(ST_MakePoint(...)).
 */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType: () => 'text[]',
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: citext('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  nameNormalized: text('name_normalized').notNull(),
  street: text('street'),
  city: text('city'),
  country: text('country'),
  location: geographyPoint('location').notNull(),
  osmId: bigint('osm_id', { mode: 'number' }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const visits = pgTable('visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  venueId: uuid('venue_id').notNull(),
  visitedAt: timestamp('visited_at', { withTimezone: true }).notNull(),
  visitedMonth: date('visited_month'),
  description: text('description').notNull().default(''),
  rating: smallint('rating').notNull(),
  priceIndication: smallint('price_indication'),
  tags: textArray('tags').notNull(),
  visibility: text('visibility').notNull().default('private'),
  moderationHidden: boolean('moderation_hidden').notNull().default(false),
  moderatedBy: uuid('moderated_by'),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const visitPhotos = pgTable('visit_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  visitId: uuid('visit_id').notNull(),
  storagePath: text('storage_path').notNull(),
  thumbPath: text('thumb_path').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  contentHash: bytea('content_hash').notNull(),
  position: smallint('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const visitAttendees = pgTable('visit_attendees', {
  id: uuid('id').primaryKey().defaultRandom(),
  visitId: uuid('visit_id').notNull(),
  personId: uuid('person_id'),
  freeName: text('free_name'),
});

export const friendships = pgTable('friendships', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id').notNull(),
  addresseeId: uuid('addressee_id').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
});

export const crawls = pgTable('crawls', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  crawlDate: date('crawl_date').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const crawlStops = pgTable('crawl_stops', {
  id: uuid('id').primaryKey().defaultRandom(),
  crawlId: uuid('crawl_id').notNull(),
  visitId: uuid('visit_id').notNull(),
  position: smallint('position').notNull(),
  distanceFromPrevM: doublePrecision('distance_from_prev_m'),
});

export const contentReports = pgTable('content_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  visitId: uuid('visit_id').notNull(),
  reporterUserId: uuid('reporter_user_id'),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  handledBy: uuid('handled_by'),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  details: jsonb('details').notNull().default({}),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------- anonieme publicatie */

/**
 * Deze views worden alleen via de read-only pool gelezen. Ze staan hier zodat
 * de kolomnamen op een plek gecontroleerd worden; de definitie zelf leeft in
 * migratie 0004.
 */
export const publicVenueAggregates = pgView('public_venue_aggregates', {
  venueId: uuid('venue_id').notNull(),
  reportCount: integer('report_count').notNull(),
  reporterCount: integer('reporter_count').notNull(),
  avgRating: text('avg_rating'),
  firstMonth: date('first_month'),
  lastMonth: date('last_month'),
  topTags: textArray('top_tags').notNull(),
}).existing();

export const publicVisitReports = pgView('public_visit_reports', {
  reportId: uuid('report_id').notNull(),
  venueId: uuid('venue_id').notNull(),
  rating: smallint('rating').notNull(),
  tags: textArray('tags').notNull(),
  description: text('description').notNull(),
  visitedMonth: date('visited_month'),
}).existing();
