import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CrawlDetailDto, CrawlDto, Paged, VisitDto } from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { formatDate, formatDistance, formatRating, formatTime} from '../lib/format.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Spinner,
  TextArea,
  TextInput,
  Stars,
} from '../components/ui.js';

export function CrawlsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const crawls = useQuery({
    queryKey: ['crawls'],
    queryFn: () => api.get<{ items: CrawlDto[] }>('/api/crawls'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<CrawlDto>('/api/crawls', { name: name.trim(), crawlDate: date, notes }),
    onSuccess: async () => {
      setName('');
      setNotes('');
      await queryClient.invalidateQueries({ queryKey: ['crawls'] });
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">Kroegentochten</h1>

      <Card>
        <h2 className="mb-3 font-medium text-ink">Nieuwe tocht</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Naam">
            <TextInput
              value={name}
              maxLength={120}
              placeholder="Binnenstadronde"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Datum">
            <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        </div>
        <Field label="Notities">
          <TextArea
            rows={2}
            value={notes}
            maxLength={4000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="mt-3">
          <Button
            onClick={() => create.mutate()}
            disabled={name.trim().length === 0 || create.isPending}
          >
            Tocht aanmaken
          </Button>
        </div>
        <ErrorText error={create.error} />
      </Card>

      {crawls.isLoading ? <Spinner label="Tochten ophalen" /> : null}
      <ErrorText error={crawls.error} />

      {crawls.data && crawls.data.items.length === 0 ? (
        <EmptyState title="Nog geen tochten">
          Maak er een aan en kies hem daarna bij het vastleggen van een bezoek.
        </EmptyState>
      ) : null}

      <div className="space-y-2">
        {crawls.data?.items.map((crawl) => (
          <Card key={crawl.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                to={`/tochten/${crawl.id}`}
                className="font-medium text-ink hover:underline"
              >
                {crawl.name}
              </Link>
              <span className="text-sm text-ink-soft">{formatDate(crawl.crawlDate)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-ink-soft">
              <span>
                {crawl.stopCount} stop{crawl.stopCount === 1 ? '' : 's'}
              </span>
              <span>{formatDistance(crawl.totalDistanceM)}</span>
              <span>gemiddeld {formatRating(crawl.averageRating)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function CrawlDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const crawl = useQuery({
    queryKey: ['crawl', id],
    queryFn: () => api.get<CrawlDetailDto>(`/api/crawls/${id}`),
  });

  /** Eigen bezoeken die nog in geen tocht zitten, om toe te voegen. */
  const candidates = useQuery({
    queryKey: ['crawl-candidates'],
    queryFn: () =>
      api.get<Paged<VisitDto>>(`/api/visits${query({ limit: 100, sort: 'visited_desc' })}`),
    enabled: adding,
  });

  const setStops = useMutation({
    mutationFn: (visitIds: string[]) => api.put<void>(`/api/crawls/${id}/stops`, { visitIds }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['crawl', id] });
      await queryClient.invalidateQueries({ queryKey: ['crawls'] });
      await queryClient.invalidateQueries({ queryKey: ['crawl-candidates'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del<void>(`/api/crawls/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['crawls'] });
      navigate('/tochten');
    },
  });

  if (crawl.isLoading) return <Spinner label="Tocht ophalen" />;
  if (crawl.error) return <ErrorText error={crawl.error} />;
  if (!crawl.data) return null;

  const detail = crawl.data;
  const stopVisitIds = detail.stops.map((stop) => stop.visit.id);

  const move = (index: number, direction: -1 | 1) => {
    const next = [...stopVisitIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    setStops.mutate(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{detail.name}</h1>
          <p className="text-sm text-ink-soft">{formatDate(detail.crawlDate)}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-ink-soft">
          <Badge>{detail.stopCount} stops</Badge>
          <Badge>{formatDistance(detail.totalDistanceM)}</Badge>
          <Badge>gemiddeld {formatRating(detail.averageRating)}</Badge>
        </div>
      </div>

      {detail.notes ? (
        <Card>
          <p className="whitespace-pre-wrap text-sm">{detail.notes}</p>
        </Card>
      ) : null}

      {detail.attendees.length > 0 ? (
        <Card>
          <h2 className="text-sm font-medium text-ink">Wie er die avond bij waren</h2>
          <p className="mt-1 text-sm text-ink-soft">{detail.attendees.join(', ')}</p>
        </Card>
      ) : null}

      {/* De tijdlijn: chronologisch, met de afstand tussen de stops ertussen. */}
      <ol className="space-y-2">
        {detail.stops.map((stop, index) => (
          <li key={stop.visit.id}>
            {index > 0 ? (
              <div className="flex items-center gap-2 py-1 pl-4 text-xs text-ink-soft">
                <span className="h-6 w-px bg-canvas" />
                {formatDistance(stop.distanceFromPrevM)} verder
              </div>
            ) : null}
            <Card className="flex gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-soft text-sm font-semibold text-amber-ink">
                {index + 1}
              </div>
              {stop.visit.photos[0] ? (
                <img
                  src={stop.visit.photos[0].thumbUrl}
                  alt=""
                  loading="lazy"
                  className="size-20 shrink-0 rounded-lg border border-line object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    to={`/bezoeken/${stop.visit.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {stop.visit.venue.name}
                  </Link>
                  <Stars rating={stop.visit.rating} />
                  <span className="text-xs text-ink-soft">
                    {formatTime(stop.visit.visitedAt)}
                  </span>
                </div>
                {stop.visit.description ? (
                  <p className="mt-1 text-sm">{stop.visit.description}</p>
                ) : null}
                {stop.visit.attendees.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-soft">
                    met {stop.visit.attendees.map((a) => a.name).join(', ')}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="rounded px-2 text-ink-soft hover:bg-canvas disabled:opacity-30"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || setStops.isPending}
                  aria-label="Eerder in de tocht"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded px-2 text-ink-soft hover:bg-canvas disabled:opacity-30"
                  onClick={() => move(index, 1)}
                  disabled={index === detail.stops.length - 1 || setStops.isPending}
                  aria-label="Later in de tocht"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded px-2 text-ink-soft hover:bg-canvas"
                  onClick={() =>
                    setStops.mutate(stopVisitIds.filter((v) => v !== stop.visit.id))
                  }
                  aria-label="Uit de tocht halen"
                >
                  ×
                </button>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      {detail.stops.length === 0 ? (
        <EmptyState title="Nog geen stops">
          Voeg bezoeken toe, of kies deze tocht bij het vastleggen van een bezoek.
        </EmptyState>
      ) : null}

      <ErrorText error={setStops.error} />

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAdding(!adding)}>
          {adding ? 'Sluiten' : 'Bezoek toevoegen'}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm('Tocht verwijderen? De bezoeken zelf blijven bestaan.')) {
              remove.mutate();
            }
          }}
        >
          Tocht verwijderen
        </Button>
      </div>

      {adding ? (
        <Card>
          <h2 className="mb-2 font-medium text-ink">Bezoek toevoegen</h2>
          {candidates.isLoading ? <Spinner /> : null}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {candidates.data?.items
              .filter((visit) => !stopVisitIds.includes(visit.id))
              .map((visit) => (
                <li key={visit.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-canvas"
                    onClick={() => setStops.mutate([...stopVisitIds, visit.id])}
                  >
                    {visit.venue.name}
                    <span className="ml-2 text-xs text-ink-soft">
                      {formatDate(visit.visitedAt)}
                      {visit.crawlId ? ' — zit nu in een andere tocht' : ''}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-ink-faint">
        Afstanden zijn hemelsbreed tussen de tenten gerekend met PostGIS, niet de route die je
        werkelijk liep.
      </p>
    </div>
  );
}
