import { env } from '../config/env.js';

/**
 * Uitgaande verzoeken naar OpenStreetMap en Nominatim.
 *
 * Beide diensten stellen eisen aan wie hun capaciteit gebruikt: een
 * identificeerbare User-Agent met contactmogelijkheid, geen bulk-downloads, en
 * bij Nominatim maximaal een verzoek per seconde. Dat wordt hier afgedwongen in
 * plaats van in de aanroepende code, zodat het niet per ongeluk ergens omheen
 * kan.
 */

export const USER_AGENT = `Kroegentocht/1.0 (self-hosted; ${env.PUBLIC_BASE_URL}; ${env.CONTACT_EMAIL})`;

/** Serieel poortje met een minimale tussentijd tussen twee verzoeken. */
export class RateGate {
  private queue: Promise<void> = Promise.resolve();
  private lastStart = 0;

  constructor(private readonly minIntervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastStart);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStart = Date.now();
      return fn();
    });
    // De wachtrij mag niet stoppen als een verzoek faalt.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Nominatim staat maximaal een verzoek per seconde toe; 1100 ms is de marge. */
export const nominatimGate = new RateGate(1100);

/**
 * Tegelijkertijd hoogstens een paar tiles ophalen. Het gebruiksbeleid van
 * OpenStreetMap verbiedt bulk-downloaden; een cachende proxy voor een handvol
 * gebruikers met een lage parallelliteit valt daar niet onder.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

export const tileLimiter = new ConcurrencyLimiter(4);

/**
 * Minimale vorm van een fetch-antwoord, alleen wat we echt gebruiken.
 *
 * Dit staat hier expliciet in plaats van dat we op de globale Response-typen
 * leunen: welke definitie daarvan actief is verschilt per combinatie van
 * @types/node en de lib-instelling, en dat leverde eerder verwarrende
 * typefouten op zonder dat er iets mis was met de code.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
}

export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {},
): Promise<HttpResponse> {
  const { timeoutMs = 8000, headers = {}, method = 'GET' } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(url, {
      method,
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, ...headers },
      redirect: 'follow',
    });
    return response as unknown as HttpResponse;
  } finally {
    clearTimeout(timer);
  }
}
