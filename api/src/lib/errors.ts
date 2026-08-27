/** Foutklassen met een expliciete statuscode, zodat routes niets hoeven te weten
 *  over hoe een fout uiteindelijk wordt geserialiseerd. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Niet ingelogd.') =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'Geen toegang.') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'Niet gevonden.') =>
  new HttpError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details);

export const payloadTooLarge = (message: string) =>
  new HttpError(413, 'payload_too_large', message);

export const unsupportedMediaType = (message: string) =>
  new HttpError(415, 'unsupported_media_type', message);

export const tooManyRequests = (message = 'Te veel verzoeken.') =>
  new HttpError(429, 'too_many_requests', message);

export const internal = (message = 'Interne fout.') =>
  new HttpError(500, 'internal_error', message);
