import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DEDUPE_RADIUS_M, VISIBILITIES } from '@kroegentocht/shared';
import type { CrawlDto, VenueDto } from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { toLocalInputValue, fromLocalInputValue } from '../lib/format.js';
import {
  enqueueVisit,
  flushQueue,
  newIdempotencyKey,
  type QueuedVisitPayload,
} from '../lib/offline-queue.js';
import { LocationPicker, type PickedLocation } from '../components/LocationPicker.js';
import { PeoplePicker, type AttendeeSelection } from '../components/PeoplePicker.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { PriceInput, RatingInput, TagInput } from '../components/inputs.js';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorText,
  Field,
  Notice,
  Select,
  TextArea,
  TextInput,
} from '../components/ui.js';

const VISIBILITY_LABELS: Record<(typeof VISIBILITIES)[number], string> = {
  private: 'Alleen ik',
  friends: 'Ik en mijn vrienden',
  public_anonymous: 'Anoniem melden op de kaart',
};

const VISIBILITY_HELP: Record<(typeof VISIBILITIES)[number], string> = {
  private: 'Niemand anders ziet dit bezoek.',
  friends: 'Je geaccepteerde vrienden zien het volledige bezoek, inclusief fotos.',
  public_anonymous:
    'Alleen de tent, je cijfer, je tags, je tekst en de maand worden gepubliceerd. Geen naam, geen exact tijdstip, geen fotos, geen deelnemers. Een tent verschijnt pas op de kaart vanaf drie verschillende melders.',
};

/**
 * Bezoek vastleggen in een formulier.
 *
 * Opslaan schrijft altijd eerst naar de offline wachtrij en probeert daarna te
 * versturen. Daardoor is er geen verschil tussen online en offline invullen, en
 * kan het niet gebeuren dat een slechte verbinding een avond wist.
 */
export function NewVisitPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [visitedAt, setVisitedAt] = useState(() => toLocalInputValue(new Date()));
  const [rating, setRating] = useState(4);
  const [price, setPrice] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [attendees, setAttendees] = useState<AttendeeSelection[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [visibility, setVisibility] = useState<(typeof VISIBILITIES)[number]>('private');
  const [crawlId, setCrawlId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const crawls = useQuery({
    queryKey: ['crawls'],
    queryFn: () => api.get<{ items: CrawlDto[] }>('/api/crawls'),
    staleTime: 60_000,
  });

  const filterOptions = useQuery({
    queryKey: ['visit-filter-options'],
    queryFn: () =>
      api.get<{ cities: Array<{ city: string }>; tags: Array<{ tag: string }> }>(
        '/api/visits/filters/options',
      ),
    staleTime: 5 * 60_000,
  });

  /**
   * Tenten in de buurt, zodat je aan een bestaande kunt koppelen in plaats van
   * een duplicaat te maken. De server doet de deduplicatie alsnog bij het
   * opslaan; dit is er om het zichtbaar te maken voordat je opslaat.
   */
  const nearbyVenues = useQuery({
    queryKey: ['venues-nearby', location?.lat, location?.lon],
    queryFn: () =>
      api.get<{ items: VenueDto[] }>(
        `/api/venues/search${query({ lat: location?.lat, lon: location?.lon, radius: 120, limit: 8 })}`,
      ),
    enabled: location !== null,
    staleTime: 60_000,
  });

  // Naamsuggestie uit een zoekresultaat overnemen, maar nooit iets overschrijven
  // wat de gebruiker zelf al typte.
  useEffect(() => {
    if (location?.suggestedName && name.trim().length === 0) {
      setName(location.suggestedName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.suggestedName]);

  const selectedVenue = useMemo(
    () => nearbyVenues.data?.items.find((v) => v.id === venueId) ?? null,
    [nearbyVenues.data, venueId],
  );

  const canSave =
    (venueId !== null || (name.trim().length > 0 && location !== null)) && visitedAt.length > 0;

  const save = async () => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const payload: QueuedVisitPayload = {
        ...(venueId
          ? { venueId }
          : {
              venue: {
                name: name.trim(),
                ...(location?.street ? { street: location.street } : {}),
                ...(location?.city ? { city: location.city } : {}),
                ...(location?.country ? { country: location.country } : {}),
                lat: location!.lat,
                lon: location!.lon,
                ...(location?.osmId !== undefined ? { osmId: location.osmId } : {}),
              },
            }),
        visitedAt: fromLocalInputValue(visitedAt),
        description: description.trim(),
        rating,
        priceIndication: price,
        tags,
        visibility,
        attendees: attendees.map((a) => ({
          ...(a.personId ? { personId: a.personId } : {}),
          ...(a.name ? { name: a.name } : {}),
          remember: a.remember,
        })),
        ...(crawlId ? { crawlId } : {}),
        idempotencyKey: newIdempotencyKey(),
      };

      await enqueueVisit(payload, photos);
      const result = await flushQueue();

      await queryClient.invalidateQueries({ queryKey: ['visits'] });
      await queryClient.invalidateQueries({ queryKey: ['stats'] });
      await queryClient.invalidateQueries({ queryKey: ['people'] });

      if (result.sent > 0) {
        navigate('/bezoeken');
        return;
      }

      setNotice(
        'Opgeslagen op dit toestel. Het bezoek gaat automatisch weg zodra er weer verbinding is.',
      );
      // Formulier leeg, zodat je de volgende tent kunt invullen.
      setPhotos([]);
      setDescription('');
      setTags([]);
      setName('');
      setVenueId(null);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">Bezoek vastleggen</h1>

      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorText error={error} />

      <Card>
        <CardTitle step={1}>Foto</CardTitle>
        <PhotoPicker files={photos} onChange={setPhotos} />
      </Card>

      <Card>
        <CardTitle step={2}>Waar was je</CardTitle>
        <LocationPicker
          value={location}
          onChange={(next) => {
            setLocation(next);
            // Een nieuwe locatie maakt een eerder gekozen bestaande tent
            // twijfelachtig; de lijst hieronder wordt opnieuw geladen.
            setVenueId(null);
          }}
        />

        {location && (nearbyVenues.data?.items.length ?? 0) > 0 ? (
          <div className="mt-3 rounded-lg border border-line p-3">
            <p className="mb-2 text-sm text-ink-soft">
              Binnen {DEDUPE_RADIUS_M} meter herkent de app een bestaande tent automatisch. Deze
              staan hier in de buurt:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {nearbyVenues.data?.items.map((venue) => (
                <button
                  key={venue.id}
                  type="button"
                  onClick={() => {
                    if (venueId === venue.id) {
                      setVenueId(null);
                    } else {
                      setVenueId(venue.id);
                      setName(venue.name);
                    }
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    venueId === venue.id
                      ? 'bg-amber font-medium text-ink'
                      : 'bg-canvas text-ink ring-1 ring-line hover:bg-surface'
                  }`}
                >
                  {venue.name}
                  {venue.street ? (
                    <span className="ml-1 text-xs text-ink-soft">{venue.street}</span>
                  ) : null}
                </button>
              ))}
            </div>
            {selectedVenue ? (
              <p className="mt-2 text-xs text-ink-soft">
                Dit bezoek komt bij de bestaande tent {selectedVenue.name}.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle step={3}>De tent</CardTitle>
        <div className="space-y-3">
          <Field label="Naam van de tent">
            <TextInput
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setVenueId(null);
              }}
              placeholder="Cafe De Zwaan"
              maxLength={200}
            />
          </Field>

          <Field label="Wanneer">
            <TextInput
              type="datetime-local"
              value={visitedAt}
              onChange={(event) => setVisitedAt(event.target.value)}
            />
          </Field>

          <Field label="Waardering">
            <RatingInput value={rating} onChange={setRating} />
          </Field>

          <Field label="Prijsindicatie" hint="Optioneel. Nog een keer klikken maakt het leeg.">
            <PriceInput value={price} onChange={setPrice} />
          </Field>

          <Field label="Beschrijving">
            <TextArea
              rows={4}
              value={description}
              maxLength={4000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Wat viel op, wat dronk je, wie was er lastig?"
            />
          </Field>

          <Field label="Tags">
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={filterOptions.data?.tags.map((t) => t.tag) ?? []}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardTitle step={4}>Wie waren erbij</CardTitle>
        <PeoplePicker value={attendees} onChange={setAttendees} />
      </Card>

      <Card>
        <CardTitle step={5}>Tocht en zichtbaarheid</CardTitle>
        <div className="space-y-3">
          <Field label="Onderdeel van een tocht" hint="Optioneel, bepaalt de tijdlijn en de afstand.">
            <Select value={crawlId} onChange={(event) => setCrawlId(event.target.value)}>
              <option value="">Losse tent, geen tocht</option>
              {crawls.data?.items.map((crawl) => (
                <option key={crawl.id} value={crawl.id}>
                  {crawl.name} ({crawl.crawlDate})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Zichtbaarheid">
            <Select
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as (typeof VISIBILITIES)[number])
              }
            >
              {VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {VISIBILITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-soft">
            {VISIBILITY_HELP[visibility]}
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={!canSave || saving}>
          {saving ? 'Opslaan…' : 'Bezoek opslaan'}
        </Button>
        {!canSave ? (
          <Badge tone="warn">Naam en locatie zijn nodig</Badge>
        ) : (
          <span className="text-xs text-ink-soft">
            Opslaan werkt ook zonder verbinding.
          </span>
        )}
      </div>
    </div>
  );
}
