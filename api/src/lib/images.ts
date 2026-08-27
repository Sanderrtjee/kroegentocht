import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  FULL_IMAGE_MAX_EDGE,
  MAX_UPLOAD_BYTES,
  THUMB_IMAGE_MAX_EDGE,
} from '@kroegentocht/shared';
import { payloadTooLarge, unsupportedMediaType } from './errors.js';

/**
 * Beeldverwerking.
 *
 * Twee dingen zijn hier hard:
 *
 * 1. Het formaat wordt bepaald op magic bytes, niet op de extensie of de
 *    Content-Type die de client meestuurt. Een bestand dat "foto.jpg" heet maar
 *    een zip is, wordt geweigerd.
 * 2. Alles wordt hergecodeerd naar webp zonder metadata. sharp neemt EXIF alleen
 *    mee als je expliciet withMetadata() aanroept, en dat doen we niet. De
 *    uitkomst wordt daarna nog een keer gecontroleerd, zodat een toekomstige
 *    wijziging niet stil GPS-coordinaten laat doorlekken.
 */

export type DetectedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Kijkt naar de eerste bytes van het bestand zelf. */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => buffer[index] === byte)) return 'image/png';

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ProcessedUpload {
  full: ProcessedImage;
  thumb: ProcessedImage;
  /** sha256 over de hergecodeerde webp, voor deduplicatie van dezelfde foto. */
  contentHash: Buffer;
  detectedType: DetectedImageType;
}

async function assertNoMetadata(buffer: Buffer, label: string): Promise<void> {
  const meta = await sharp(buffer).metadata();
  if (meta.exif || meta.icc || meta.iptc || meta.xmp) {
    throw new Error(
      `Hergecodeerde afbeelding (${label}) bevat nog metadata; upload afgebroken.`,
    );
  }
}

/**
 * Verwerkt een upload naar een volledige weergave en een thumbnail.
 *
 * rotate() zonder argument past de EXIF-orientatie toe voordat de metadata
 * verdwijnt. Zonder die stap staan foto's van een telefoon op hun kant zodra je
 * de EXIF weggooit.
 */
export async function processUpload(input: Buffer): Promise<ProcessedUpload> {
  if (input.length > MAX_UPLOAD_BYTES) {
    throw payloadTooLarge(
      `Bestand is groter dan ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    );
  }

  const detectedType = detectImageType(input);
  if (!detectedType) {
    throw unsupportedMediaType('Alleen jpeg, png en webp worden geaccepteerd.');
  }

  // limitInputPixels beschermt tegen een klein bestand dat naar honderden
  // megapixels decomprimeert.
  const base = sharp(input, { limitInputPixels: 100_000_000, failOn: 'error' });

  const probe = await base.metadata();
  if (!probe.width || !probe.height) {
    throw unsupportedMediaType('Afbeelding kon niet gelezen worden.');
  }

  const fullBuffer = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize({
      width: FULL_IMAGE_MAX_EDGE,
      height: FULL_IMAGE_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const thumbBuffer = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize({
      width: THUMB_IMAGE_MAX_EDGE,
      height: THUMB_IMAGE_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 72, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  await assertNoMetadata(fullBuffer.data, 'volledig');
  await assertNoMetadata(thumbBuffer.data, 'thumbnail');

  return {
    full: {
      buffer: fullBuffer.data,
      width: fullBuffer.info.width,
      height: fullBuffer.info.height,
    },
    thumb: {
      buffer: thumbBuffer.data,
      width: thumbBuffer.info.width,
      height: thumbBuffer.info.height,
    },
    contentHash: createHash('sha256').update(fullBuffer.data).digest(),
    detectedType,
  };
}
