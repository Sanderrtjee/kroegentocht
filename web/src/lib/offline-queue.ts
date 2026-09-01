import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VisitDto } from '@kroegentocht/shared';
import { ApiError, NetworkError, api } from './api.js';

/**
 * Offline wachtrij voor het vastleggen van een bezoek.
 *
 * In een kroeg is de dekking slecht, en juist daar wil je iets vastleggen. Dus
 * gaat elk bezoek eerst naar IndexedDB, met de fotos erbij, en pas daarna naar de
 * server. Er is dus maar een code-pad: opslaan lukt altijd, en versturen is een
 * aparte stap die opnieuw geprobeerd kan worden.
 *
 * Waarom niet de Background Sync API van de service worker: die bestaat alleen
 * in Chromium, en op iOS dus niet. Dit werkt overal, en de service worker doet
 * alleen wat hij goed kan, namelijk het cachen van de app en de kaarttegels.
 *
 * Dubbel versturen kan geen duplicaat opleveren: elk item heeft een
 * idempotencyKey die de server onthoudt.
 */

/**
 * Fotos worden als ArrayBuffer bewaard en niet als File of Blob.
 *
 * Dat is geen willekeurige keuze. WebKit kan een File uit de camera of de
 * fotobibliotheek niet betrouwbaar in IndexedDB zetten: dat zijn schijf-gebonden
 * verwijzingen, en op iOS levert dat "Error preparing Blob/File data to be
 * stored in object store" op. Een ArrayBuffer is gewone binaire data en wordt
 * overal zonder problemen gekopieerd. Bij het versturen bouwen we er weer een
 * Blob van.
 */
export interface QueuedPhoto {
  name: string;
  type: string;
  bytes: ArrayBuffer;
}

export interface QueuedVisitPayload {
  venueId?: string;
  venue?: {
    name: string;
    street?: string;
    city?: string;
    country?: string;
    lat: number;
    lon: number;
    osmId?: number;
  };
  visitedAt: string;
  description: string;
  rating: number;
  priceIndication?: number | null;
  tags: string[];
  visibility: 'private' | 'friends' | 'public_anonymous';
  attendees: Array<{ personId?: string; name?: string; remember: boolean }>;
  crawlId?: string;
  idempotencyKey: string;
}

export interface QueuedVisit {
  id: string;
  payload: QueuedVisitPayload;
  /** Kan bij oude records nog Blob of File bevatten; zie toFormDataPhotos. */
  photos: Array<QueuedPhoto | Blob>;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Wordt gezet als de server het bezoek al aannam maar de fotos nog niet. */
  serverVisitId: string | null;
  /**
   * Gezet na een afwijzing die niet vanzelf overgaat. Zulke items blijven staan
   * zodat je ze kunt zien, maar worden niet elke minuut opnieuw geprobeerd.
   */
  permanentError?: boolean;
}

interface KroegentochtDb extends DBSchema {
  'pending-visits': {
    key: string;
    value: QueuedVisit;
    indexes: { 'by-createdAt': number };
  };
}

let dbPromise: Promise<IDBPDatabase<KroegentochtDb>> | null = null;

function getDb(): Promise<IDBPDatabase<KroegentochtDb>> {
  // Versie 2: fotos worden nu als ArrayBuffer bewaard. Bestaande records blijven
  // staan; de verzendcode kan met beide vormen om, zodat een item dat al in de
  // wachtrij stond niet verloren gaat.
  dbPromise ??= openDB<KroegentochtDb>('kroegentocht', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('pending-visits', { keyPath: 'id' });
        store.createIndex('by-createdAt', 'createdAt');
      }
    },
  });
  return dbPromise;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Zet de gekozen bestanden om naar iets dat IndexedDB overal accepteert. */
async function toQueuedPhotos(files: readonly File[]): Promise<QueuedPhoto[]> {
  const out: QueuedPhoto[] = [];
  for (const [index, file] of files.entries()) {
    out.push({
      name: file.name || `foto-${index + 1}.jpg`,
      type: file.type || 'image/jpeg',
      bytes: await file.arrayBuffer(),
    });
  }
  return out;
}

export async function enqueueVisit(
  payload: QueuedVisitPayload,
  files: readonly File[],
): Promise<QueuedVisit> {
  const record: QueuedVisit = {
    id: payload.idempotencyKey,
    payload,
    photos: await toQueuedPhotos(files),
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    serverVisitId: null,
  };
  const db = await getDb();
  await db.put('pending-visits', record);
  notify();
  return record;
}

export async function listQueue(): Promise<QueuedVisit[]> {
  const db = await getDb();
  return db.getAllFromIndex('pending-visits', 'by-createdAt');
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('pending-visits', id);
  notify();
}

async function saveQueueItem(record: QueuedVisit): Promise<void> {
  const db = await getDb();
  await db.put('pending-visits', record);
  notify();
}

/* ------------------------------------------------------------- abonnementen */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------- flushen */

export interface FlushResult {
  sent: number;
  failed: number;
  stillQueued: number;
}

let flushing = false;

/**
 * Bouwt de multipart-body op. Verwerkt zowel de nieuwe ArrayBuffer-vorm als een
 * Blob of File uit een record van voor deze wijziging. Onbruikbare items worden
 * overgeslagen in plaats van de hele verzending te laten mislukken: het bezoek
 * zelf is belangrijker dan de foto.
 */
function toFormDataPhotos(record: QueuedVisit): { form: FormData; count: number } {
  const form = new FormData();
  let count = 0;

  record.photos.forEach((photo, index) => {
    try {
      if (photo instanceof Blob) {
        const name = photo instanceof File ? photo.name : `foto-${index + 1}.jpg`;
        form.append('photo', photo, name);
      } else {
        form.append('photo', new Blob([photo.bytes], { type: photo.type }), photo.name);
      }
      count += 1;
    } catch {
      // Een record uit een oudere versie waarvan de File niet meer te lezen is.
      // Overslaan; het bezoek gaat wel door.
    }
  });

  return { form, count };
}

/**
 * Probeert de hele wachtrij te versturen.
 *
 * Een netwerkfout laat het item staan voor de volgende poging. Een afwijzing
 * door de server met een 4xx anders dan 429 markeert het item als blijvend
 * mislukt: dat verzoek gaat nooit lukken, en elke minuut opnieuw proberen levert
 * alleen een teller op die naar 46 loopt. Het item blijft wel zichtbaar, en de
 * knop "nu proberen te versturen" doet het alsnog.
 */
export async function flushQueue(options: { includeFailed?: boolean } = {}): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, stillQueued: (await listQueue()).length };
  flushing = true;

  let sent = 0;
  let failed = 0;

  try {
    for (const record of await listQueue()) {
      if (record.permanentError && !options.includeFailed) continue;

      try {
        let visitId = record.serverVisitId;

        if (!visitId) {
          const visit = await api.post<VisitDto>('/api/visits', record.payload);
          visitId = visit.id;
          // Vastleggen dat het bezoek er is, zodat een mislukte foto-upload niet
          // leidt tot een tweede poging op het bezoek zelf.
          await saveQueueItem({ ...record, serverVisitId: visitId });
        }

        const { form, count } = toFormDataPhotos(record);
        if (count > 0) {
          await api.postForm(`/api/visits/${visitId}/photos`, form);
        }

        await removeFromQueue(record.id);
        sent += 1;
      } catch (err) {
        failed += 1;

        if (err instanceof NetworkError) {
          await saveQueueItem({
            ...record,
            attempts: record.attempts + 1,
            lastError: 'Geen verbinding, blijft in de wachtrij.',
          });
          // Verder proberen is zinloos zolang er geen netwerk is.
          break;
        }

        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          await saveQueueItem({
            ...record,
            attempts: record.attempts + 1,
            lastError: `Server weigerde dit bezoek: ${err.message}`,
            permanentError: true,
          });
          continue;
        }

        await saveQueueItem({
          ...record,
          attempts: record.attempts + 1,
          lastError: err instanceof Error ? err.message : 'Onbekende fout',
        });
      }
    }
  } finally {
    flushing = false;
  }

  return { sent, failed, stillQueued: (await listQueue()).length };
}

/** Zet de automatische verzendpogingen aan: bij online komen en periodiek. */
export function startQueueWorker(onFlushed?: (result: FlushResult) => void): () => void {
  const run = () => {
    if (!navigator.onLine) return;
    void flushQueue().then((result) => {
      if (result.sent > 0 && onFlushed) onFlushed(result);
    });
  };

  run();
  window.addEventListener('online', run);
  const timer = window.setInterval(run, 60_000);

  return () => {
    window.removeEventListener('online', run);
    window.clearInterval(timer);
  };
}
