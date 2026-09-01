import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { VISIBILITIES } from '@kroegentocht/shared';
import type { Paged, PersonDto, VisitDto } from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { formatDateTime} from '../lib/format.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Select,
  Spinner,
  TextInput,
  Stars,
} from '../components/ui.js';

interface Filters {
  page: number;
  ratingMin: string;
  ratingMax: string;
  from: string;
  to: string;
  city: string;
  tags: string;
  personId: string;
  visibility: string;
  q: string;
  sort: string;
}

const EMPTY_FILTERS: Filters = {
  page: 1,
  ratingMin: '',
  ratingMax: '',
  from: '',
  to: '',
  city: '',
  tags: '',
  personId: '',
  visibility: '',
  q: '',
  sort: 'visited_desc',
};

const VISIBILITY_LABELS: Record<string, string> = {
  private: 'privé',
  friends: 'vrienden',
  public_anonymous: 'anoniem gemeld',
};

export function VisitCard({ visit, compact = false }: { visit: VisitDto; compact?: boolean }) {
  const firstPhoto = visit.photos[0];
  return (
    <Card className="flex gap-3">
      {firstPhoto ? (
        <img
          src={firstPhoto.thumbUrl}
          alt=""
          loading="lazy"
          className="size-20 shrink-0 rounded-lg border border-line object-cover"
        />
      ) : (
        <div className="grid size-20 shrink-0 place-items-center rounded-lg border border-dashed border-line text-xs text-ink-faint">
          geen foto
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link to={`/bezoeken/${visit.id}`} className="font-medium text-ink hover:underline">
            {visit.venue.name}
          </Link>
          <Stars rating={visit.rating} />
          <Badge>{VISIBILITY_LABELS[visit.visibility] ?? visit.visibility}</Badge>
        </div>
        <p className="text-xs text-ink-soft">
          {formatDateTime(visit.visitedAt)}
          {visit.venue.city ? ` — ${visit.venue.city}` : ''}
        </p>
        {!compact && visit.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-ink">{visit.description}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          {visit.attendees.length > 0 ? (
            <span>met {visit.attendees.map((a) => a.name).join(', ')}</span>
          ) : null}
          {visit.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-canvas px-2 py-0.5 ring-1 ring-line">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function VisitsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const options = useQuery({
    queryKey: ['visit-filter-options'],
    queryFn: () =>
      api.get<{ cities: Array<{ city: string; count: number }>; tags: Array<{ tag: string; count: number }> }>(
        '/api/visits/filters/options',
      ),
    staleTime: 5 * 60_000,
  });

  const people = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get<{ items: PersonDto[] }>('/api/people'),
    staleTime: 60_000,
  });

  const visits = useQuery({
    queryKey: ['visits', filters],
    queryFn: () =>
      api.get<Paged<VisitDto>>(
        `/api/visits${query({
          page: filters.page,
          limit: 25,
          ratingMin: filters.ratingMin,
          ratingMax: filters.ratingMax,
          from: filters.from,
          to: filters.to,
          city: filters.city,
          tags: filters.tags,
          personId: filters.personId,
          visibility: filters.visibility,
          q: filters.q,
          sort: filters.sort,
        })}`,
      ),
  });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? (value as number) : 1 }));

  const totalPages = visits.data ? Math.max(1, Math.ceil(visits.data.total / visits.data.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">Mijn bezoeken</h1>
        {visits.data ? (
          <span className="text-sm text-ink-soft">{visits.data.total} in totaal</span>
        ) : null}
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Zoeken">
            <TextInput
              value={filters.q}
              placeholder="Tekst of naam van de tent"
              onChange={(event) => set('q', event.target.value)}
            />
          </Field>
          <Field label="Plaats">
            <Select value={filters.city} onChange={(event) => set('city', event.target.value)}>
              <option value="">Alle plaatsen</option>
              {options.data?.cities.map((city) => (
                <option key={city.city} value={city.city}>
                  {city.city} ({city.count})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aanwezige">
            <Select
              value={filters.personId}
              onChange={(event) => set('personId', event.target.value)}
            >
              <option value="">Iedereen</option>
              {people.data?.items.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} ({person.visitCount})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" hint="Kommagescheiden, alle tags moeten voorkomen.">
            <TextInput
              value={filters.tags}
              placeholder="bier, terras"
              onChange={(event) => set('tags', event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cijfer vanaf">
              <Select
                value={filters.ratingMin}
                onChange={(event) => set('ratingMin', event.target.value)}
              >
                <option value="">Geen minimum</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="tot en met">
              <Select
                value={filters.ratingMax}
                onChange={(event) => set('ratingMax', event.target.value)}
              >
                <option value="">Geen maximum</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Van">
              <TextInput
                type="date"
                value={filters.from}
                onChange={(event) => set('from', event.target.value)}
              />
            </Field>
            <Field label="Tot en met">
              <TextInput
                type="date"
                value={filters.to}
                onChange={(event) => set('to', event.target.value)}
              />
            </Field>
          </div>
          <Field label="Zichtbaarheid">
            <Select
              value={filters.visibility}
              onChange={(event) => set('visibility', event.target.value)}
            >
              <option value="">Alles</option>
              {VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {VISIBILITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sorteren">
            <Select value={filters.sort} onChange={(event) => set('sort', event.target.value)}>
              <option value="visited_desc">Nieuwste eerst</option>
              <option value="visited_asc">Oudste eerst</option>
              <option value="rating_desc">Hoogste cijfer eerst</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
            Filters wissen
          </Button>
        </div>
      </Card>

      {visits.isLoading ? <Spinner label="Bezoeken ophalen" /> : null}
      <ErrorText error={visits.error} />

      {visits.data && visits.data.items.length === 0 ? (
        <EmptyState title="Niets gevonden">
          Pas de filters aan, of leg je eerste bezoek vast.
        </EmptyState>
      ) : null}

      <div className="space-y-3">
        {visits.data?.items.map((visit) => (
          <VisitCard key={visit.id} visit={visit} />
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            disabled={filters.page <= 1}
            onClick={() => setFilters((c) => ({ ...c, page: c.page - 1 }))}
          >
            Vorige
          </Button>
          <span className="text-sm text-ink-soft">
            {filters.page} van {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={filters.page >= totalPages}
            onClick={() => setFilters((c) => ({ ...c, page: c.page + 1 }))}
          >
            Volgende
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function VisitDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const visit = useQuery({
    queryKey: ['visit', id],
    queryFn: () => api.get<VisitDto>(`/api/visits/${id}`),
  });

  const remove = useMutation({
    mutationFn: () => api.del<void>(`/api/visits/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['visits'] });
      navigate('/bezoeken');
    },
  });

  if (visit.isLoading) return <Spinner label="Bezoek ophalen" />;
  if (visit.error) return <ErrorText error={visit.error} />;
  if (!visit.data) return null;

  const item = visit.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">{item.venue.name}</h1>
        <Stars rating={item.rating} className="text-lg" />
      </div>

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-soft">Wanneer</dt>
            <dd>{formatDateTime(item.visitedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Waar</dt>
            <dd>
              {[item.venue.street, item.venue.city, item.venue.country].filter(Boolean).join(', ') ||
                // Een tent zonder adres is een marker die met de hand op de kaart is
                // gezet, zonder Nominatim-zoekopdracht. Coordinaten zijn er dan wel
                // altijd; een kale streep zou hier niets zeggen.
                `${item.venue.lat.toFixed(5)}, ${item.venue.lon.toFixed(5)}`}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Zichtbaarheid</dt>
            <dd>{VISIBILITY_LABELS[item.visibility] ?? item.visibility}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Aanwezig</dt>
            <dd>{item.attendees.map((a) => a.name).join(', ') || '–'}</dd>
          </div>
        </dl>

        {item.description ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{item.description}</p>
        ) : null}

        {item.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-canvas px-2 py-0.5 text-xs ring-1 ring-line">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      {item.photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {item.photos.map((photo) => (
            <a key={photo.id} href={photo.fullUrl} target="_blank" rel="noreferrer">
              <img
                src={photo.thumbUrl}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded-lg border border-line object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {item.crawlId ? (
          <Link
            to={`/tochten/${item.crawlId}`}
            className="rounded-lg bg-canvas px-4 py-2 text-sm hover:bg-line"
          >
            Naar de tocht
          </Link>
        ) : null}
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm('Dit bezoek en de fotos definitief verwijderen?')) {
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
        >
          Bezoek verwijderen
        </Button>
      </div>
      <ErrorText error={remove.error} />
    </div>
  );
}
