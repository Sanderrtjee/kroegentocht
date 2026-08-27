import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * argon2id met parameters die op een i5 met 16 GB ruim haalbaar zijn en toch
 * pijnlijk voor een aanvaller: 64 MiB geheugen, drie iteraties, twee threads.
 * Dat is bewust zwaarder dan de OWASP-ondergrens van 19 MiB, omdat dit een
 * homelab met weinig gelijktijdige logins is.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 2,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    // Een onleesbare hash is geen geldige login, maar ook geen serverfout.
    return false;
  }
}

/**
 * Verbrandt ongeveer dezelfde tijd als een echte verificatie, voor het geval
 * de gebruikersnaam niet bestaat. Zonder dit is uit de responstijd af te leiden
 * welke gebruikersnamen bestaan.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await hash('bewust-weggegooid-wachtwoord-voor-timing', OPTIONS);
}
