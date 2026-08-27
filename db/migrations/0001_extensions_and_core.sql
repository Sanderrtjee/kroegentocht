-- 0001 extensions, users, sessions, venues
-- Alle tijdstempels zijn timestamptz. Alle primary keys zijn uuid.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy naamvergelijking bij venue-deduplicatie
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitieve gebruikersnaam

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      citext NOT NULL,
  password_hash text   NOT NULL,
  role          text   NOT NULL DEFAULT 'user',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_uq UNIQUE (username),
  CONSTRAINT users_username_len CHECK (char_length(username) BETWEEN 3 AND 32),
  CONSTRAINT users_role_ck CHECK (role IN ('user', 'moderator', 'admin'))
);

-- Serverside sessies: een sessie kan direct worden ingetrokken en verdwijnt
-- volledig bij het verwijderen van een account. Er wordt bewust geen IP en
-- geen user-agent bij een sessie bewaard.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT sessions_token_hash_uq UNIQUE (token_hash)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Een venue is gedeelde, niet-persoonlijke data. created_by wordt daarom op
-- NULL gezet als de aanmaker zijn account verwijdert; de tent blijft bestaan.
CREATE TABLE venues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  name_normalized text NOT NULL,
  street          text,
  city            text,
  country         text,
  location        geography(Point, 4326) NOT NULL,
  osm_id          bigint,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venues_name_len CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT venues_name_normalized_len CHECK (char_length(name_normalized) >= 1)
);

CREATE INDEX venues_location_gix ON venues USING GIST (location);
CREATE INDEX venues_name_normalized_trgm_idx ON venues USING GIN (name_normalized gin_trgm_ops);
CREATE INDEX venues_city_idx ON venues (lower(city));
CREATE UNIQUE INDEX venues_osm_id_uidx ON venues (osm_id) WHERE osm_id IS NOT NULL;

-- Backstop tegen exacte duplicaten. De echte deduplicatie is fuzzy (naam plus
-- 50 meter, zie api/src/lib/venue-match.ts); dit vangt alleen de race waarin
-- twee identieke inserts door de applicatiecheck heen glippen. Het raster van
-- 0.0005 graden is ruwweg 55 bij 35 meter op de breedtegraad van Nederland.
CREATE UNIQUE INDEX venues_name_grid_uidx
  ON venues (name_normalized, ST_SnapToGrid(location::geometry, 0.0005));
