import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { StatsDto } from '@kroegentocht/shared';
import { api } from '../lib/api.js';
import { formatDistance, formatMonth, formatRating } from '../lib/format.js';
import { Card, EmptyState, ErrorText, Spinner } from '../components/ui.js';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-nacht-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-nacht-200">{value}</p>
      {sub ? <p className="text-xs text-nacht-400">{sub}</p> : null}
    </Card>
  );
}

export function StatsPage() {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<StatsDto>('/api/stats'),
  });

  if (stats.isLoading) return <Spinner label="Statistiek berekenen" />;
  if (stats.error) return <ErrorText error={stats.error} />;
  if (!stats.data) return null;

  const data = stats.data;
  if (data.visitCount === 0) {
    return (
      <EmptyState title="Nog niets te tellen">
        Leg een bezoek vast, dan komt hier je overzicht.
      </EmptyState>
    );
  }

  const maxMonth = Math.max(1, ...data.perMonth.map((m) => m.visitCount));
  const maxRating = Math.max(1, ...data.ratingHistogram.map((r) => r.count));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-nacht-200">Statistiek</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tenten" value={String(data.venueCount)} sub={`${data.visitCount} bezoeken`} />
        <Stat label="Steden" value={String(data.cityCount)} />
        <Stat
          label="Tochten"
          value={String(data.crawlCount)}
          sub={`${formatDistance(data.totalDistanceM)} hemelsbreed`}
        />
        <Stat label="Gemiddeld cijfer" value={formatRating(data.averageRating)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h2 className="font-medium text-nacht-200">Hoogst gewaardeerde tent</h2>
          {data.topVenue ? (
            <p className="mt-2">
              <span className="text-lg text-bier-400">{formatRating(data.topVenue.avgRating)}</span>{' '}
              <span className="font-medium">{data.topVenue.name}</span>
              {data.topVenue.city ? (
                <span className="text-nacht-400"> — {data.topVenue.city}</span>
              ) : null}
              <span className="block text-xs text-nacht-400">
                over {data.topVenue.visitCount} bezoek
                {data.topVenue.visitCount === 1 ? '' : 'en'}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-nacht-400">Nog niets.</p>
          )}
        </Card>

        <Card>
          <h2 className="font-medium text-nacht-200">Vaakste metgezel</h2>
          {data.topCompanion ? (
            <p className="mt-2">
              <span className="font-medium">{data.topCompanion.name}</span>
              <span className="block text-xs text-nacht-400">
                bij {data.topCompanion.visitCount} bezoek
                {data.topCompanion.visitCount === 1 ? '' : 'en'}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-nacht-400">
              Nog geen aanwezigen ingevuld.{' '}
              <Link to="/instellingen" className="text-bier-400 underline">
                Maatjes beheren
              </Link>
            </p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-medium text-nacht-200">Verdeling van je cijfers</h2>
        <div className="space-y-1.5">
          {data.ratingHistogram.map((row) => (
            <div key={row.rating} className="flex items-center gap-2 text-sm">
              <span className="w-16 shrink-0 text-bier-400">{'★'.repeat(row.rating)}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-nacht-800">
                <div
                  className="h-full rounded bg-bier-500"
                  style={{ width: `${(row.count / maxRating) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-nacht-400">{row.count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium text-nacht-200">Bezoeken per maand</h2>
        <div className="flex items-end gap-1 overflow-x-auto pb-2">
          {data.perMonth.map((month) => (
            <div key={month.month} className="flex w-10 shrink-0 flex-col items-center gap-1">
              <div
                className="w-6 rounded-t bg-bier-500"
                style={{ height: `${Math.max(4, (month.visitCount / maxMonth) * 120)}px` }}
                title={`${formatMonth(month.month)}: ${month.visitCount}`}
              />
              <span className="text-[0.65rem] text-nacht-400">{month.month.slice(2)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
