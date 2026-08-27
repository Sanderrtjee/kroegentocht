import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { K_ANONYMITY_THRESHOLD } from '@kroegentocht/shared';
import type {
  HeatPointDto,
  MineMapFeature,
  PublicMapFeature,
  PublicReportDto,
  VisitDto,
} from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { formatDateTime, formatMonth, formatRating, stars } from '../lib/format.js';
import { MapCanvas } from '../map/MapCanvas.js';
import type { Bounds, MapAdapter, MapPoint } from '../map/MapAdapter.js';
import { Badge, Button, Card, ErrorText, Spinner, TextArea } from '../components/ui.js';

/**
 * De kaart.
 *
 * Twee lagen die los aan en uit kunnen:
 *
 * - Eigen bezochte tenten: ronde, goudkleurige markers met het aantal bezoeken.
 * - Anoniem gemelde tenten van anderen: blauwe ruiten. Die staan er pas op vanaf
 *   drie verschillende melders, dus een enkele melding is nergens te zien.
 *
 * De vorm verschilt naast de kleur, zodat de lagen ook zonder kleurwaarneming te
 * onderscheiden zijn.
 *
 * De server filtert op het zichtbare kaartvlak; bij elke beweging wordt de
 * bounding box meegestuurd. Zoom je uit, dan clustert Leaflet de markers.
 */

interface Viewport {
  bbox: string;
  zoom: number;
}

function bboxParam(bounds: Bounds): string {
  return [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat]
    .map((n) => n.toFixed(6))
    .join(',');
}

type Selection =
  | { kind: 'mine'; venueId: string; name: string }
  | { kind: 'public'; venueId: string; name: string; feature: PublicMapFeature };

export function MapPage() {
  const adapterRef = useRef<MapAdapter | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [showMine, setShowMine] = useState(true);
  const [showPublic, setShowPublic] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [nearbyRadius, setNearbyRadius] = useState<number | null>(null);

  const onViewportChange = useCallback((bounds: Bounds, zoom: number) => {
    setViewport({ bbox: bboxParam(bounds), zoom });
  }, []);

  const mine = useQuery({
    queryKey: ['map-mine', viewport?.bbox, viewport?.zoom],
    queryFn: () =>
      api.get<{ items: MineMapFeature[] }>(
        `/api/map/mine${query({ bbox: viewport!.bbox, zoom: viewport!.zoom, limit: 1000 })}`,
      ),
    enabled: viewport !== null && showMine,
    staleTime: 30_000,
  });

  const publicLayer = useQuery({
    queryKey: ['map-public', viewport?.bbox, viewport?.zoom],
    queryFn: () =>
      api.get<{ items: PublicMapFeature[] }>(
        `/api/map/public${query({ bbox: viewport!.bbox, zoom: viewport!.zoom, limit: 1000 })}`,
      ),
    enabled: viewport !== null && showPublic,
    staleTime: 30_000,
  });

  const heat = useQuery({
    queryKey: ['map-heat', viewport?.bbox, viewport?.zoom],
    queryFn: () =>
      api.get<{ items: HeatPointDto[] }>(
        `/api/map/heatmap${query({ bbox: viewport!.bbox, zoom: viewport!.zoom })}`,
      ),
    enabled: viewport !== null && showHeat,
    staleTime: 60_000,
  });

  const nearby = useQuery({
    queryKey: ['map-nearby', nearbyRadius, viewport?.bbox],
    queryFn: async () => {
      const center = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
        });
      });
      return api.get<{ items: Array<PublicMapFeature & { distanceM: number | null }> }>(
        `/api/map/nearby${query({
          lat: center.coords.latitude,
          lon: center.coords.longitude,
          radius: nearbyRadius ?? 1000,
          layer: 'public',
          limit: 25,
        })}`,
      );
    },
    enabled: nearbyRadius !== null,
    retry: false,
  });

  /* De laagdata naar de kaart brengen. */
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const points: MapPoint[] = (mine.data?.items ?? []).map((feature) => ({
      id: feature.venueId,
      lat: feature.lat,
      lon: feature.lon,
      badge: String(feature.visitCount),
      title: feature.name,
      lines: [
        `Gemiddeld ${formatRating(feature.avgRating)} over ${feature.visitCount} bezoek${feature.visitCount === 1 ? '' : 'en'}`,
        `Laatst: ${formatDateTime(feature.lastVisitedAt)}`,
        feature.city ?? '',
      ].filter(Boolean),
      selectLabel: 'Mijn bezoeken hier',
      onSelect: () =>
        setSelection({ kind: 'mine', venueId: feature.venueId, name: feature.name }),
    }));
    adapter.setPoints('mine', points);
  }, [mine.data]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const points: MapPoint[] = (publicLayer.data?.items ?? []).map((feature) => ({
      id: feature.venueId,
      lat: feature.lat,
      lon: feature.lon,
      badge: formatRating(feature.avgRating),
      title: feature.name,
      lines: [
        `Gemiddeld ${formatRating(feature.avgRating)} uit ${feature.reportCount} melding${feature.reportCount === 1 ? '' : 'en'}`,
        `${feature.reporterCount} verschillende melders`,
        feature.topTags.length > 0 ? feature.topTags.join(', ') : '',
        `${formatMonth(feature.firstMonth)} tot ${formatMonth(feature.lastMonth)}`,
      ].filter(Boolean),
      selectLabel: 'Meldingen lezen',
      onSelect: () =>
        setSelection({ kind: 'public', venueId: feature.venueId, name: feature.name, feature }),
    }));
    adapter.setPoints('public', points);
  }, [publicLayer.data]);

  useEffect(() => {
    adapterRef.current?.setHeatPoints(heat.data?.items ?? []);
  }, [heat.data]);

  useEffect(() => {
    adapterRef.current?.setLayerVisible('mine', showMine);
  }, [showMine]);
  useEffect(() => {
    adapterRef.current?.setLayerVisible('public', showPublic);
  }, [showPublic]);
  useEffect(() => {
    adapterRef.current?.setLayerVisible('heat', showHeat);
  }, [showHeat]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold text-nacht-200">Kaart</h1>
        <LayerToggle
          label="Mijn tenten"
          checked={showMine}
          onChange={setShowMine}
          swatchClass="kt-marker kt-marker-mine size-4"
          count={mine.data?.items.length}
        />
        <LayerToggle
          label="Anonieme meldingen"
          checked={showPublic}
          onChange={setShowPublic}
          swatchClass="kt-marker kt-marker-public size-3.5"
          count={publicLayer.data?.items.length}
        />
        <LayerToggle label="Heatmap" checked={showHeat} onChange={setShowHeat} />
        <Button
          variant="secondary"
          onClick={() => setNearbyRadius(nearbyRadius === null ? 1000 : null)}
        >
          {nearbyRadius === null ? 'In de buurt' : 'Buurtlijst sluiten'}
        </Button>
      </div>

      {mine.isFetching || publicLayer.isFetching ? <Spinner label="Kaart bijwerken" /> : null}
      <ErrorText error={mine.error ?? publicLayer.error} />

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <MapCanvas
          className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-nacht-700"
          center={{ lat: 52.0907, lon: 5.1214 }}
          zoom={14}
          onReady={(adapter) => {
            adapterRef.current = adapter;
            adapter.setLayerVisible('mine', showMine);
            adapter.setLayerVisible('public', showPublic);
            adapter.setLayerVisible('heat', showHeat);
          }}
          onViewportChange={onViewportChange}
        />

        <div className="space-y-3">
          {nearbyRadius !== null ? (
            <NearbyPanel
              radius={nearbyRadius}
              onRadiusChange={setNearbyRadius}
              loading={nearby.isFetching}
              error={nearby.error}
              items={nearby.data?.items ?? []}
              onPick={(feature) => {
                adapterRef.current?.flyTo({ lat: feature.lat, lon: feature.lon }, 18);
                setSelection({
                  kind: 'public',
                  venueId: feature.venueId,
                  name: feature.name,
                  feature,
                });
              }}
            />
          ) : null}

          {selection?.kind === 'mine' ? (
            <MineDetailPanel
              venueId={selection.venueId}
              name={selection.name}
              onClose={() => setSelection(null)}
            />
          ) : null}

          {selection?.kind === 'public' ? (
            <PublicDetailPanel
              feature={selection.feature}
              onClose={() => setSelection(null)}
            />
          ) : null}

          {selection === null && nearbyRadius === null ? (
            <Card>
              <h2 className="font-medium text-nacht-200">Twee lagen</h2>
              <p className="mt-2 text-sm text-nacht-400">
                De goudkleurige rondjes zijn tenten waar jij was. De blauwe ruiten zijn anonieme
                meldingen van anderen. Klik op een marker voor de details.
              </p>
              <p className="mt-2 text-sm text-nacht-400">
                Een tent komt pas op de anonieme laag vanaf {K_ANONYMITY_THRESHOLD} verschillende
                melders. Bij minder melders zou de marker zelf al verraden dat iemand daar was.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LayerToggle({
  label,
  checked,
  onChange,
  swatchClass,
  count,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  swatchClass?: string;
  count?: number;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
        checked ? 'border-bier-500/60 bg-nacht-800' : 'border-nacht-700 text-nacht-400'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {swatchClass ? <span className={swatchClass} aria-hidden="true" /> : null}
      {label}
      {count !== undefined ? <Badge>{count}</Badge> : null}
    </label>
  );
}

function MineDetailPanel({
  venueId,
  name,
  onClose,
}: {
  venueId: string;
  name: string;
  onClose: () => void;
}) {
  const visits = useQuery({
    queryKey: ['map-venue-mine', venueId],
    queryFn: () => api.get<{ items: VisitDto[] }>(`/api/map/venues/${venueId}/mine`),
  });

  return (
    <Card>
      <PanelHeader title={name} subtitle="Mijn bezoeken" onClose={onClose} />
      {visits.isLoading ? <Spinner /> : null}
      <ErrorText error={visits.error} />
      <div className="mt-2 space-y-3">
        {visits.data?.items.map((visit) => (
          <div key={visit.id} className="flex gap-2 border-t border-nacht-800 pt-2">
            {visit.photos[0] ? (
              <img
                src={visit.photos[0].thumbUrl}
                alt=""
                loading="lazy"
                className="size-16 shrink-0 rounded-lg border border-nacht-700 object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <p className="text-sm text-bier-400">{stars(visit.rating)}</p>
              <p className="text-xs text-nacht-400">{formatDateTime(visit.visitedAt)}</p>
              {visit.description ? (
                <p className="mt-1 line-clamp-3 text-sm">{visit.description}</p>
              ) : null}
              <Link to={`/bezoeken/${visit.id}`} className="text-xs text-bier-400 underline">
                Bekijk bezoek
              </Link>
            </div>
          </div>
        ))}
        {visits.data && visits.data.items.length === 0 ? (
          <p className="text-sm text-nacht-400">Hier heb je nog geen bezoek vastgelegd.</p>
        ) : null}
      </div>
    </Card>
  );
}

function PublicDetailPanel({
  feature,
  onClose,
}: {
  feature: PublicMapFeature;
  onClose: () => void;
}) {
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState<string[]>([]);

  const reports = useQuery({
    queryKey: ['venue-reports', feature.venueId],
    queryFn: () =>
      api.get<{ items: PublicReportDto[] }>(
        `/api/map/venues/${feature.venueId}/reports${query({ limit: 25 })}`,
      ),
  });

  const flag = useMutation({
    mutationFn: (input: { reportId: string; reason: string }) =>
      api.post<{ contentReportId: string }>('/api/moderation/reports', input),
    onSuccess: (_data, variables) => {
      setReported((current) => [...current, variables.reportId]);
      setReportingId(null);
      setReason('');
    },
  });

  return (
    <Card>
      <PanelHeader title={feature.name} subtitle="Anonieme meldingen" onClose={onClose} />
      <p className="mt-1 text-sm text-nacht-400">
        {formatRating(feature.avgRating)} gemiddeld uit {feature.reportCount} melding
        {feature.reportCount === 1 ? '' : 'en'} van {feature.reporterCount} verschillende mensen.
      </p>
      {feature.topTags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {feature.topTags.map((tag) => (
            <span key={tag} className="rounded-full bg-nacht-800 px-2 py-0.5 text-xs">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {reports.isLoading ? <Spinner /> : null}
      <ErrorText error={reports.error} />

      <ul className="mt-3 space-y-3">
        {reports.data?.items.map((report) => (
          <li key={report.reportId} className="border-t border-nacht-800 pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-bier-400">{stars(report.rating)}</span>
              <span className="text-xs text-nacht-400">{formatMonth(report.visitedMonth)}</span>
            </div>
            {report.description ? (
              <p className="mt-1 whitespace-pre-wrap text-sm">{report.description}</p>
            ) : null}
            {report.tags.length > 0 ? (
              <p className="mt-1 text-xs text-nacht-400">{report.tags.join(', ')}</p>
            ) : null}

            {reported.includes(report.reportId) ? (
              <p className="mt-1 text-xs text-emerald-300">Gemeld bij een moderator.</p>
            ) : reportingId === report.reportId ? (
              <div className="mt-2 space-y-2">
                <TextArea
                  rows={2}
                  value={reason}
                  maxLength={500}
                  placeholder="Wat is er mis met deze tekst?"
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      flag.mutate({ reportId: report.reportId, reason: reason.trim() })
                    }
                    disabled={reason.trim().length === 0 || flag.isPending}
                  >
                    Versturen
                  </Button>
                  <Button variant="ghost" onClick={() => setReportingId(null)}>
                    Annuleren
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="mt-1 text-xs text-nacht-400 underline hover:text-red-300"
                onClick={() => setReportingId(report.reportId)}
              >
                Ongepast, melden
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText error={flag.error} />
      <p className="mt-3 text-xs text-nacht-600">
        Van een anonieme melding zijn alleen de tent, het cijfer, de tags, de tekst en de maand
        bekend. Wie het schreef staat nergens vast in wat hier wordt uitgeleverd.
      </p>
    </Card>
  );
}

function NearbyPanel({
  radius,
  onRadiusChange,
  loading,
  error,
  items,
  onPick,
}: {
  radius: number;
  onRadiusChange: (value: number) => void;
  loading: boolean;
  error: unknown;
  items: Array<PublicMapFeature & { distanceM: number | null }>;
  onPick: (feature: PublicMapFeature) => void;
}) {
  return (
    <Card>
      <h2 className="font-medium text-nacht-200">In de buurt</h2>
      <label className="mt-2 block text-sm text-nacht-400">
        Straal: {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
        <input
          type="range"
          min={200}
          max={5000}
          step={200}
          value={radius}
          onChange={(event) => onRadiusChange(Number(event.target.value))}
          className="mt-1 w-full"
        />
      </label>
      {loading ? <Spinner label="Locatie en tenten ophalen" /> : null}
      {error ? (
        <p className="mt-2 text-sm text-amber-300">
          Locatie bepalen lukte niet. Zonder locatie kan deze lijst niet.
        </p>
      ) : null}
      <ul className="mt-2 space-y-1">
        {items.map((feature) => (
          <li key={feature.venueId}>
            <button
              type="button"
              onClick={() => onPick(feature)}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-nacht-800"
            >
              <span className="font-medium">{feature.name}</span>
              <span className="ml-2 text-xs text-nacht-400">
                {feature.distanceM !== null ? `${feature.distanceM} m` : ''} ·{' '}
                {formatRating(feature.avgRating)} uit {feature.reportCount}
              </span>
            </button>
          </li>
        ))}
        {!loading && items.length === 0 ? (
          <li className="text-sm text-nacht-400">
            Niets binnen deze straal boven de meldingsdrempel.
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

function PanelHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h2 className="font-medium text-nacht-200">{title}</h2>
        <p className="text-xs text-nacht-400">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg px-2 text-nacht-400 hover:bg-nacht-800"
        aria-label="Paneel sluiten"
      >
        ×
      </button>
    </div>
  );
}
