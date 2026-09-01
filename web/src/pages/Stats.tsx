import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Paged, StatsDto, VisitDto } from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { formatDate, formatDistance, formatMonth, formatRating } from '../lib/format.js';
import { Avatar, Button, Card, EmptyState, ErrorText, Pill, Spinner, Stars } from '../components/ui.js';

/**
 * Startpagina.
 *
 * Als je de app opent wil je zien waar je geweest bent, niet meteen een leeg
 * formulier. Vastleggen zit een tik verder, in de amberkleurige knop die op een
 * telefoon midden in de tabbalk staat.
 */

function Tile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'amber' | 'green';
}) {
  const tones: Record<string, string> = {
    neutral: 'text-ink',
    amber: 'text-amber-ink',
    green: 'text-green-ink',
  };
  return (
    <Card className="flex flex-col justify-between">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`mt-1 font-display text-3xl font-bold leading-none ${tones[tone]}`}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-ink-soft">{sub}</p> : null}
    </Card>
  );
}

export function StatsPage() {
  const { user } = useAuth();

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<StatsDto>('/api/stats'),
  });

  const recent = useQuery({
    queryKey: ['visits', 'recent'],
    queryFn: () =>
      api.get<Paged<VisitDto>>(`/api/visits${query({ limit: 3, sort: 'visited_desc' })}`),
    staleTime: 30_000,
  });

  if (stats.isLoading) return <Spinner label="Overzicht ophalen" />;
  if (stats.error) return <ErrorText error={stats.error} />;
  if (!stats.data) return null;

  const data = stats.data;

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 6) return 'Nog wakker';
    if (hour < 12) return 'Goedemorgen';
    if (hour < 18) return 'Goedemiddag';
    return 'Goedenavond';
  })();

  if (data.visitCount === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-ink">
          {greeting}, {user?.username}
        </h1>
        <EmptyState title="Nog geen kroeg vastgelegd" icon="🍺">
          De eerste ronde is aan jou
        </EmptyState>
        <Link to="/vastleggen" className="block">
          <Button className="w-full">Eerste bezoek vastleggen</Button>
        </Link>
      </div>
    );
  }

  const maxMonth = Math.max(1, ...data.perMonth.map((m) => m.visitCount));
  const maxRating = Math.max(1, ...data.ratingHistogram.map((r) => r.count));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">
          {greeting}, {user?.username}
        </h1>
        <p className="font-hand text-xl text-amber-ink">
          {data.venueCount} tenten in {data.cityCount}{' '}
          {data.cityCount === 1 ? 'stad' : 'steden'}, en het houdt niet op
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Tenten"
          value={String(data.venueCount)}
          sub={`${data.visitCount} bezoeken`}
          tone="amber"
        />
        <Tile label="Steden" value={String(data.cityCount)} />
        <Tile
          label="Tochten"
          value={String(data.crawlCount)}
          sub={`${formatDistance(data.totalDistanceM)} hemelsbreed`}
          tone="green"
        />
        <Tile label="Gemiddeld" value={formatRating(data.averageRating)} sub="van 5 sterren" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-base font-semibold text-ink">
            Hoogst gewaardeerde tent
          </h2>
          {data.topVenue ? (
            <div className="mt-2">
              <div className="flex items-baseline gap-2">
                <Stars rating={data.topVenue.avgRating} className="text-lg" />
                <span className="font-display font-semibold text-ink">
                  {formatRating(data.topVenue.avgRating)}
                </span>
              </div>
              <p className="mt-1 font-medium text-ink">{data.topVenue.name}</p>
              <p className="text-sm text-ink-soft">
                {data.topVenue.city ? `${data.topVenue.city} · ` : ''}
                {data.topVenue.visitCount} bezoek
                {data.topVenue.visitCount === 1 ? '' : 'en'}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">Nog niets.</p>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-base font-semibold text-ink">Vaakste metgezel</h2>
          {data.topCompanion ? (
            <div className="mt-2 flex items-center gap-2.5">
              <Avatar name={data.topCompanion.name} />
              <div>
                <p className="font-medium text-ink">{data.topCompanion.name}</p>
                <p className="text-sm text-ink-soft">
                  bij {data.topCompanion.visitCount} bezoek
                  {data.topCompanion.visitCount === 1 ? '' : 'en'}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">
              Nog geen aanwezigen ingevuld.{' '}
              <Link to="/instellingen" className="font-medium text-amber-ink underline">
                Maatjes beheren
              </Link>
            </p>
          )}
        </Card>
      </div>

      {recent.data && recent.data.items.length > 0 ? (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-base font-semibold text-ink">Laatst geweest</h2>
            <Link to="/bezoeken" className="text-sm font-medium text-amber-ink hover:underline">
              Alles bekijken
            </Link>
          </div>
          <ul className="space-y-2">
            {recent.data.items.map((visit) => (
              <Card as="li" key={visit.id} className="flex items-center gap-3">
                {visit.photos[0] ? (
                  <img
                    src={visit.photos[0].thumbUrl}
                    alt=""
                    loading="lazy"
                    className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-line"
                  />
                ) : (
                  <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-canvas text-xl ring-1 ring-line">
                    🍻
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/bezoeken/${visit.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {visit.venue.name}
                  </Link>
                  <p className="text-xs text-ink-soft">
                    {formatDate(visit.visitedAt)}
                    {visit.venue.city ? ` · ${visit.venue.city}` : ''}
                  </p>
                </div>
                <Stars rating={visit.rating} />
              </Card>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Verdeling van je cijfers
        </h2>
        <div className="space-y-2">
          {[...data.ratingHistogram].reverse().map((row) => (
            <div key={row.rating} className="flex items-center gap-2.5 text-sm">
              <Stars rating={row.rating} className="w-20 shrink-0 text-xs" />
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
                <div
                  className="h-full rounded-full bg-amber"
                  style={{ width: `${(row.count / maxRating) * 100}%` }}
                />
              </div>
              <span className="w-7 shrink-0 text-right text-ink-soft">{row.count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-base font-semibold text-ink">
          Bezoeken per maand
        </h2>
        <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
          {data.perMonth.map((month) => (
            <div key={month.month} className="flex w-11 shrink-0 flex-col items-center gap-1">
              <span className="text-xs font-medium text-ink-soft">{month.visitCount}</span>
              <div
                className="w-7 rounded-t-lg bg-green"
                style={{ height: `${Math.max(6, (month.visitCount / maxMonth) * 110)}px` }}
                title={`${formatMonth(month.month)}: ${month.visitCount}`}
              />
              <span className="text-[0.65rem] text-ink-faint">{month.month.slice(2)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Pill>Afstanden zijn hemelsbreed, niet de route die je liep</Pill>
      </div>
    </div>
  );
}
