-- 0002 visits, foto's, maatjes, aanwezigen

CREATE TABLE visits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id          uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  visited_at        timestamptz NOT NULL,
  -- Grofkorrelige maand voor de anonieme publicatie. De expressie is immutable
  -- (timezone(text, timestamptz) en date_trunc(text, timestamp) zijn dat beide),
  -- zodat dit een STORED generated column kan zijn.
  visited_month     date GENERATED ALWAYS AS
                      ((date_trunc('month', timezone('Europe/Amsterdam', visited_at)))::date) STORED,
  description       text NOT NULL DEFAULT '',
  rating            smallint NOT NULL,
  price_indication  smallint,
  tags              text[] NOT NULL DEFAULT '{}',
  visibility        text NOT NULL DEFAULT 'private',
  moderation_hidden boolean NOT NULL DEFAULT false,
  moderated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  moderated_at      timestamptz,
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visits_rating_ck CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT visits_price_ck CHECK (price_indication IS NULL OR price_indication BETWEEN 1 AND 4),
  CONSTRAINT visits_visibility_ck CHECK (visibility IN ('private', 'friends', 'public_anonymous')),
  CONSTRAINT visits_description_len CHECK (char_length(description) <= 4000),
  CONSTRAINT visits_idempotency_len CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100),
  CONSTRAINT visits_tags_ck CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 12)
);

CREATE INDEX visits_user_visited_idx ON visits (user_id, visited_at DESC);
CREATE INDEX visits_venue_idx ON visits (venue_id);
CREATE INDEX visits_tags_gin_idx ON visits USING GIN (tags);
CREATE INDEX visits_public_idx ON visits (venue_id)
  WHERE visibility = 'public_anonymous' AND moderation_hidden = false;
-- Maakt het opnieuw versturen van een bezoek uit de offline wachtrij idempotent.
CREATE UNIQUE INDEX visits_idempotency_uidx ON visits (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE visit_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id     uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  thumb_path   text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  byte_size    integer NOT NULL,
  content_hash bytea NOT NULL,          -- sha256 van de hergecodeerde webp
  position     smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_photos_position_uq UNIQUE (visit_id, position),
  CONSTRAINT visit_photos_dims_ck CHECK (width > 0 AND height > 0)
);
CREATE INDEX visit_photos_visit_idx ON visit_photos (visit_id);
CREATE INDEX visit_photos_hash_idx ON visit_photos (content_hash);

-- Eigen lijstje maatjes. Dit zijn geen accounts; het zijn labels van de
-- gebruiker zelf, zodat aanwezigen hergebruikt kunnen worden.
CREATE TABLE people (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_name_len CHECK (char_length(name) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX people_user_name_uidx ON people (user_id, lower(name));

CREATE TABLE visit_attendees (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id  uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  free_name text,
  CONSTRAINT visit_attendees_one_of_ck CHECK (person_id IS NOT NULL OR free_name IS NOT NULL),
  CONSTRAINT visit_attendees_free_name_len CHECK (free_name IS NULL OR char_length(free_name) BETWEEN 1 AND 80)
);
CREATE INDEX visit_attendees_visit_idx ON visit_attendees (visit_id);
CREATE INDEX visit_attendees_person_idx ON visit_attendees (person_id);
CREATE UNIQUE INDEX visit_attendees_person_uidx ON visit_attendees (visit_id, person_id)
  WHERE person_id IS NOT NULL;
