import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GeocodeResultDto } from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { MapCanvas } from '../map/MapCanvas.js';
import type { DraggableMarkerHandle, MapAdapter } from '../map/MapAdapter.js';
import { Button, Spinner, TextInput } from './ui.js';

export interface PickedLocation {
  lat: number;
  lon: number;
  street?: string;
  city?: string;
  country?: string;
  osmId?: number;
  /** Naamsuggestie uit Nominatim, alleen om het naamveld voor te vullen. */
  suggestedName?: string;
}

/**
 * Locatie kiezen op drie manieren, precies zoals in een kroeg nodig is:
 *
 * 1. GPS van de telefoon, want daar sta je.
 * 2. Zoeken op adres, als de GPS binnen niets zinnigs geeft.
 * 3. De marker met de hand verslepen, want de GPS zit er in de binnenstad zo
 *    vijftig meter naast en dan koppelt de app je aan de tent ernaast.
 */
export function LocationPicker({
  value,
  onChange,
}: {
  value: PickedLocation | null;
  onChange: (value: PickedLocation) => void;
}) {
  const adapterRef = useRef<MapAdapter | null>(null);
  const markerRef = useRef<DraggableMarkerHandle | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [gpsState, setGpsState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const search = useQuery({
    queryKey: ['geocode', activeSearch],
    queryFn: () =>
      api.get<{ items: GeocodeResultDto[] }>(
        `/api/geocode/search${query({ q: activeSearch, limit: 6 })}`,
      ),
    enabled: activeSearch.trim().length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
  });

  /** Zet de marker en meldt de nieuwe positie aan de bovenliggende component. */
  const place = (next: PickedLocation, flyTo: boolean) => {
    onChange(next);
    const adapter = adapterRef.current;
    if (!adapter) return;

    if (markerRef.current) {
      markerRef.current.setPosition(next);
    } else {
      markerRef.current = adapter.addDraggableMarker(next, (moved) => {
        // Verslepen betekent: de gebruiker weet het beter dan het adres dat we
        // hadden. Straat en plaats blijven staan, de coordinaten worden bijgewerkt.
        setAccuracy(null);
        onChange({ ...next, lat: moved.lat, lon: moved.lon });
      });
    }
    if (flyTo) adapter.flyTo(next, 18);
  };

  const useGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsState('error');
      setGpsMessage('Dit toestel geeft geen locatie door.');
      return;
    }
    setGpsState('busy');
    setGpsMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsState('idle');
        setAccuracy(Math.round(position.coords.accuracy));
        place(
          {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            ...(value?.street ? { street: value.street } : {}),
            ...(value?.city ? { city: value.city } : {}),
          },
          true,
        );
      },
      (error) => {
        setGpsState('error');
        setGpsMessage(
          error.code === error.PERMISSION_DENIED
            ? 'Geen toestemming voor locatie. Zoek op adres of sleep de marker.'
            : 'Locatie bepalen lukte niet. Zoek op adres of sleep de marker.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  // Bij het openen van het formulier meteen de marker zetten als er al een
  // positie bekend is, bijvoorbeeld omdat het formulier hergebruikt wordt.
  useEffect(() => {
    if (value && adapterRef.current && !markerRef.current) place(value, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lon]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={useGps} disabled={gpsState === 'busy'}>
          {gpsState === 'busy' ? 'Locatie bepalen…' : 'Gebruik mijn locatie'}
        </Button>
        <TextInput
          className="max-w-64"
          value={searchTerm}
          placeholder="Zoek op adres of naam"
          onChange={(event) => setSearchTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setActiveSearch(searchTerm);
            }
          }}
        />
        <Button variant="secondary" onClick={() => setActiveSearch(searchTerm)}>
          Zoeken
        </Button>
      </div>

      {gpsMessage ? <p className="text-sm text-coral-ink">{gpsMessage}</p> : null}
      {accuracy !== null ? (
        <p className="text-xs text-ink-soft">
          GPS-nauwkeurigheid ongeveer {accuracy} meter. Sleep de marker als de tent er net naast
          staat.
        </p>
      ) : null}

      {search.isFetching ? <Spinner label="Adressen zoeken" /> : null}
      {search.isError ? (
        <p className="text-sm text-coral-ink">
          Adressen zoeken lukt nu niet. Zet de marker met de hand op de kaart.
        </p>
      ) : null}

      {search.data && search.data.items.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {search.data.items.map((result) => (
            <li key={`${result.osmId ?? result.displayName}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-canvas"
                onClick={() => {
                  place(
                    {
                      lat: result.lat,
                      lon: result.lon,
                      ...(result.street ? { street: result.street } : {}),
                      ...(result.city ? { city: result.city } : {}),
                      ...(result.country ? { country: result.country } : {}),
                      ...(result.osmId !== null ? { osmId: result.osmId } : {}),
                      suggestedName: result.name,
                    },
                    true,
                  );
                  setAccuracy(null);
                }}
              >
                <span className="font-medium text-ink">{result.name}</span>
                <span className="ml-2 text-ink-soft">{result.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <MapCanvas
        className="h-64 w-full overflow-hidden rounded-xl border border-line"
        center={value ?? { lat: 52.0907, lon: 5.1214 }}
        zoom={value ? 18 : 13}
        onReady={(adapter) => {
          adapterRef.current = adapter;
          adapter.setLayerVisible('mine', false);
          adapter.setLayerVisible('public', false);
          if (value) place(value, true);
        }}
        onMapClick={(position) => {
          place({ ...(value ?? {}), lat: position.lat, lon: position.lon }, false);
          setAccuracy(null);
        }}
      />

      <p className="text-xs text-ink-soft">
        {value
          ? `Gekozen: ${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}${value.city ? ` — ${value.city}` : ''}`
          : 'Nog geen locatie. Tik op de kaart, gebruik je locatie of zoek een adres.'}
      </p>
    </div>
  );
}
