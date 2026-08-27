-- 0003 vriendschappen, kroegentochten, moderatie, audit log

-- Minimale vriendschapsrelatie, zodat de zichtbaarheid 'friends' een echt
-- publiek heeft. People-rijen zijn labels zonder account en kunnen dat niet zijn.
CREATE TABLE friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  CONSTRAINT friendships_status_ck CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT friendships_not_self_ck CHECK (requester_id <> addressee_id)
);
-- Eén relatie per paar, ongeacht wie het verzoek deed.
CREATE UNIQUE INDEX friendships_pair_uidx ON friendships (
  LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id)
);
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX friendships_requester_idx ON friendships (requester_id, status);

CREATE TABLE crawls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  crawl_date date NOT NULL,
  notes      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crawls_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT crawls_notes_len CHECK (char_length(notes) <= 4000)
);
CREATE INDEX crawls_user_date_idx ON crawls (user_id, crawl_date DESC);

CREATE TABLE crawl_stops (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id             uuid NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  visit_id             uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  position             smallint NOT NULL,
  -- Hemelsbrede, geodetische afstand tot de vorige stop in meters. Dit is
  -- expliciet geen looproute; zie README.
  distance_from_prev_m double precision,
  CONSTRAINT crawl_stops_visit_uq UNIQUE (visit_id),
  CONSTRAINT crawl_stops_position_uq UNIQUE (crawl_id, position),
  CONSTRAINT crawl_stops_position_ck CHECK (position >= 0)
);
CREATE INDEX crawl_stops_crawl_idx ON crawl_stops (crawl_id, position);

-- Meldknop op anonieme teksten. reporter_user_id mag NULL worden zodat een
-- melding ook na accountverwijdering behandelbaar blijft.
CREATE TABLE content_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id         uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  reporter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'open',
  handled_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_reason_len CHECK (char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT content_reports_status_ck CHECK (status IN ('open', 'hidden', 'dismissed'))
);
CREATE INDEX content_reports_status_idx ON content_reports (status, created_at DESC);
CREATE INDEX content_reports_visit_idx ON content_reports (visit_id);

-- Bewust geen IP-kolom: IP-adressen worden alleen gehasht en in het geheugen
-- gebruikt voor rate limiting, en nergens gepersisteerd.
CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      uuid,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_ck CHECK (action IN ('create', 'update', 'delete'))
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
