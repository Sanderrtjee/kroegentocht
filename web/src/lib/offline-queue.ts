import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VisitDto } from '@kroegentocht/shared';
import { ApiError, NetworkError, api } from './api.js';

/**
 * Offline wachtrij voor het vastleggen van een bezoek.
 *
 * In een kroeg is de dekking slecht, en juist daar wil je iets vastleggen. Dus
 * gaat elk bezoek eerst naar IndexedDB, met de fotos erbij als Blob, en pas
 * daarna naar de server. Er is dus maar een code-pad: opslaan lukt altijd, en
 * versturen is een aparte stap die opnieuw geprobeerd kan worden.
 *
 * Waarom niet de Background Sync API van de service worker: die bestaat alleen
 * in Chromium, en op iOS dus niet. Dit werkt overal, en de service worker doet
 * alleen wat hij goed kan, namelijk het cachen van de app en de kaarttegels.
 *
 * Dubbel versturen kan geen duplicaat opleveren: elk item heeft een
 * idempotencyKey die de server onthoudt.
 */

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
  photos: Blob[];
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Wordt gezet als de server het bezoek al aannam maar de fotos nog niet. */
  serverVisitId: string | null;
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
  dbPromise ??= openDB<KroegentochtDb>('kroegentocht', 1, {
    upgrade(db) {
      const store = db.createObjectStore('pending-visits', { keyPath: 'id' });
      store.createIndex('by-createdAt', 'createdAt');
    },
  });
  return dbPromise;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function enqueueVisit(
  payload: QueuedVisitPayload,
  photos: Blob[],
): Promise<QueuedVisit> {
  const record: QueuedVisit = {
    id: payload.idempotencyKey,
    payload,
    photos,
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
  const all = await db.getAllFromIndex('pending-visits', 'by-createdAt');
  return all;
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
 * Probeert de hele wachtrij te versturen.
 *
 * Een netwerkfout laat het item staan voor de volgende poging. Een afwijzing
 * door de server met een 4xx anders dan 429 haalt het item uit de wachtrij: dat
 * verzoek gaat nooit lukken, en eindeloos opnieuw proberen zou de gebruiker
 * alleen een wachtrij geven die niet meer leeg raakt. De fout blijft wel zichtbaar.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, stillQueued: (await listQueue()).length };
  flushing = true;

  let sent = 0;
  let failed = 0;

  try {
    for (const record of await listQueue()) {
      try {
        let visitId = record.serverVisitId;

        if (!visitId) {
          const visit = await api.post<VisitDto>('/api/visits', record.payload);
          visitId = visit.id;
          // Vastleggen dat het bezoek er is, zodat een mislukte foto-upload niet
          // leidt tot een tweede poging op het bezoek zelf.
          await saveQueueItem({ ...record, serverVisitId: visitId });
        }

        if (record.photos.length > 0) {
          const form = new FormData();
          record.photos.forEach((blob, index) => {
            form.append('photo', blob, `foto-${index + 1}.jpg`);
          });
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
