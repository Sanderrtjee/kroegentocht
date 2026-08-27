import type { ApiErrorBody } from '@kroegentocht/shared';

/**
 * Dunne laag om fetch heen.
 *
 * De sessie zit in een httpOnly-cookie, dus er is geen token dat de frontend
 * moet bewaren of meesturen; same-origin verzoeken nemen de cookie automatisch
 * mee. Dat is precies de reden dat dit zo weinig code is.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? `Verzoek mislukt (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error ?? 'unknown';
    this.details = body.details;
  }
}

/** Netwerk onbereikbaar, in tegenstelling tot een afwijzing door de server. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Geen verbinding met de server.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

async function parseError(response: Response): Promise<never> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    body = { message: response.statusText };
  }
  throw new ApiError(response.status, body);
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; formData?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.formData
        ? { body: options.formData }
        : options.body !== undefined
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(options.body),
            }
          : {}),
    });
  } catch (err) {
    throw new NetworkError(err);
  }

  if (!response.ok) await parseError(response);
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>('GET', path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),
  postForm: <T>(path: string, formData: FormData) => request<T>('POST', path, { formData }),
};

/** Bouwt een querystring en laat leegwaarden weg. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const asString = search.toString();
  return asString.length > 0 ? `?${asString}` : '';
}
