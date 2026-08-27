-- 0004 anonieme publicatielaag: views plus een aparte, read-only databaserol
--
-- Dit is de kern van de privacy-eis. De anonieme laag van de applicatie praat
-- uitsluitend via een tweede connectionpool die inlogt als kroeg_public. Die
-- rol heeft GEEN SELECT op visits, users, visit_photos of visit_attendees en
-- kan die tabellen dus ook niet lezen als er ergens in de API een fout zit.
-- De views zijn eigendom van de applicatie-eigenaar en draaien met diens
-- rechten (security_invoker staat standaard uit), zodat ze wel bij de
-- onderliggende tabellen kunnen.
--
-- De k-anonimiteitsdrempel is 3 onafhankelijke melders. Die constante staat
-- hier en wordt gespiegeld in api/src/lib/anonymize.ts (K_ANONYMITY_THRESHOLD);
-- de integratietest controleert dat beide hetzelfde gedrag opleveren.

CREATE VIEW public_venue_aggregates AS
WITH reports AS (
  SELECT v.venue_id, v.user_id, v.rating, v.tags, v.visited_month
  FROM visits v
  WHERE v.visibility = 'public_anonymous'
    AND v.moderation_hidden = false
),
agg AS (
  SELECT
    venue_id,
    count(*)::int                        AS report_count,
    count(DISTINCT user_id)::int         AS reporter_count,
    round(avg(rating)::numeric, 2)       AS avg_rating,
    min(visited_month)                   AS first_month,
    max(visited_month)                   AS last_month
  FROM reports
  GROUP BY venue_id
  HAVING count(DISTINCT user_id) >= 3
),
tag_counts AS (
  SELECT r.venue_id, t.tag, count(*) AS n
  FROM reports r
  CROSS JOIN LATERAL unnest(r.tags) AS t(tag)
  WHERE r.venue_id IN (SELECT venue_id FROM agg)
  GROUP BY r.venue_id, t.tag
),
ranked_tags AS (
  SELECT venue_id, tag, n,
         row_number() OVER (PARTITION BY venue_id ORDER BY n DESC, tag) AS rn
  FROM tag_counts
),
top_tags AS (
  SELECT venue_id, array_agg(tag ORDER BY n DESC, tag) AS top_tags
  FROM ranked_tags
  WHERE rn <= 5
  GROUP BY venue_id
)
SELECT
  a.venue_id,
  a.report_count,
  a.reporter_count,
  a.avg_rating,
  a.first_month,
  a.last_month,
  COALESCE(t.top_tags, '{}'::text[]) AS top_tags
FROM agg a
LEFT JOIN top_tags t ON t.venue_id = a.venue_id;

COMMENT ON VIEW public_venue_aggregates IS
  'Geaggregeerde anonieme meldingen per tent, alleen vanaf 3 onafhankelijke melders.';

-- Kaartlaag voor anonieme meldingen. Een tent verschijnt hier pas als de
-- drempel gehaald is; onder de drempel is de tent op deze laag onzichtbaar,
-- omdat de marker zelf al zou verraden dat iemand daar geweest is.
CREATE VIEW public_venue_points AS
SELECT
  v.id                          AS venue_id,
  v.name,
  v.city,
  v.country,
  v.location,
  ST_Y(v.location::geometry)    AS lat,
  ST_X(v.location::geometry)    AS lon,
  a.report_count,
  a.reporter_count,
  a.avg_rating,
  a.first_month,
  a.last_month,
  a.top_tags
FROM venues v
JOIN public_venue_aggregates a ON a.venue_id = v.id;

COMMENT ON VIEW public_venue_points IS
  'Publieke kaartpunten: tent plus aggregaat, uitsluitend boven de k-drempel.';

-- Losse anonieme meldingen. Bevat uitsluitend venue, rating, tags, tekst en de
-- bezoekmaand. Geen user_id, geen exact tijdstip, geen fotos, geen deelnemers.
CREATE VIEW public_visit_reports AS
SELECT
  v.id            AS report_id,
  v.venue_id,
  v.rating,
  v.tags,
  v.description,
  v.visited_month
FROM visits v
JOIN public_venue_aggregates a ON a.venue_id = v.venue_id
WHERE v.visibility = 'public_anonymous'
  AND v.moderation_hidden = false;

COMMENT ON VIEW public_visit_reports IS
  'Anonieme meldingsteksten. Alleen zichtbaar bij tenten boven de k-drempel.';

-- De read-only rol. Wachtwoord en LOGIN worden niet hier gezet maar door de
-- migratierunner, uit de omgevingsvariabele DATABASE_PUBLIC_URL, zodat er geen
-- geheim in een migratiebestand staat.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kroeg_public') THEN
    CREATE ROLE kroeg_public NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kroeg_public;
REVOKE ALL ON SCHEMA public FROM kroeg_public;

GRANT USAGE ON SCHEMA public TO kroeg_public;
GRANT SELECT ON public_venue_aggregates TO kroeg_public;
GRANT SELECT ON public_venue_points TO kroeg_public;
GRANT SELECT ON public_visit_reports TO kroeg_public;
