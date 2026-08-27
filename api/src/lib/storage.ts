import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { notFound } from './errors.js';

/**
 * Opslag van media buiten de webroot.
 *
 * Bestanden staan onder MEDIA_ROOT, dat in Docker een named volume is en geen
 * onderdeel van de uitgeserveerde statische map. Er is dus geen directory
 * listing en geen directe URL; alles gaat via het geauthenticeerde
 * fotoendpoint.
 *
 * Bestandsnamen zijn gegenereerde uuids. De oorspronkelijke bestandsnaam van de
 * gebruiker wordt nergens bewaard: die kan een naam of vakantielocatie
 * verklappen en is verder nutteloos.
 */

export const mediaRoot = path.resolve(env.MEDIA_ROOT);

export async function ensureMediaRoot(): Promise<void> {
  await mkdir(mediaRoot, { recursive: true });
}

/** Relatieve paden, gegroepeerd per jaar en maand zodat mappen hanteerbaar blijven. */
export function newPhotoPaths(now: Date = new Date()): {
  id: string;
  storagePath: string;
  thumbPath: string;
} {
  const id = randomUUID();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dir = `${year}/${month}`;
  return {
    id,
    storagePath: `${dir}/${id}.webp`,
    thumbPath: `${dir}/${id}_thumb.webp`,
  };
}

/**
 * Zet een relatief pad om naar een absoluut pad en weigert alles wat buiten
 * MEDIA_ROOT uitkomt. Paden komen uit de database en niet uit een request, maar
 * deze controle kost niets en sluit padmanipulatie definitief uit.
 */
export function resolveMediaPath(relativePath: string): string {
  const absolute = path.resolve(mediaRoot, relativePath);
  const rootWithSep = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep;
  if (!absolute.startsWith(rootWithSep)) {
    throw new Error(`Pad ${relativePath} valt buiten de mediamap.`);
  }
  return absolute;
}

/** Schrijft eerst naar een tijdelijke naam en verplaatst daarna, zodat er nooit
 *  een half bestand met de definitieve naam bestaat. */
export async function writeMediaFile(relativePath: string, data: Buffer): Promise<void> {
  const absolute = resolveMediaPath(relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o640 });
  await rename(temporary, absolute);
}

export async function deleteMediaFile(relativePath: string): Promise<void> {
  try {
    await unlink(resolveMediaPath(relativePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function mediaFileStats(relativePath: string): Promise<{ size: number }> {
  try {
    const s = await stat(resolveMediaPath(relativePath));
    return { size: s.size };
  } catch {
    throw notFound('Bestand bestaat niet meer.');
  }
}

export function mediaReadStream(relativePath: string): Readable {
  return createReadStream(resolveMediaPath(relativePath));
}
