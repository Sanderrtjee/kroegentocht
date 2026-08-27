import { describe, expect, it } from 'vitest';
import { DEDUPE_RADIUS_M } from '@kroegentocht/shared';
import {
  chooseVenueMatch,
  haversineMeters,
  normalizeVenueName,
  trigramSimilarity,
  venueLockKey,
  type VenueCandidate,
} from '../../src/lib/venue-match.js';

function candidate(partial: Partial<VenueCandidate> & { name: string }): VenueCandidate {
  return {
    id: partial.id ?? `id-${partial.name}`,
    name: partial.name,
    nameNormalized: partial.nameNormalized ?? normalizeVenueName(partial.name),
    distanceM: partial.distanceM ?? 10,
    osmId: partial.osmId ?? null,
  };
}

describe('normalizeVenueName', () => {
  it('haalt diakritische tekens en interpunctie weg', () => {
    expect(normalizeVenueName('Café de Zwaan!')).toBe('zwaan');
    expect(normalizeVenueName('CAFE DE ZWAAN')).toBe('zwaan');
  });

  it('haalt een generiek voorvoegsel weg maar alleen aan het begin', () => {
    expect(normalizeVenueName('Grand Cafe de Zwaan')).toBe('zwaan');
    expect(normalizeVenueName('Eetcafe Het Anker')).toBe('anker');
    // Hier is "bar" wel onderscheidend, dus die moet blijven staan.
    expect(normalizeVenueName('De Gouden Bar')).toBe('gouden bar');
  });

  it('behandelt apostrofvarianten gelijk', () => {
    expect(normalizeVenueName("'t Vosje")).toBe(normalizeVenueName('t Vosje'));
    expect(normalizeVenueName('’t Vosje')).toBe(normalizeVenueName("'t Vosje"));
  });

  it('gooit niet alles weg als de naam alleen uit stopwoorden bestaat', () => {
    expect(normalizeVenueName('De Het')).toBe('de het');
    expect(normalizeVenueName('Cafe')).toBe('cafe');
  });

  it('schrijft een ampersand uit', () => {
    expect(normalizeVenueName('Jansen & Zonen')).toBe('jansen en zonen');
  });
});

describe('trigramSimilarity', () => {
  it('geeft 1 voor identieke tekst', () => {
    expect(trigramSimilarity('zwaan', 'zwaan')).toBe(1);
  });

  it('geeft 0 voor niets gemeenschappelijk', () => {
    expect(trigramSimilarity('zwaan', 'kist')).toBe(0);
  });

  it('geeft een tussenwaarde voor een tikfout', () => {
    const score = trigramSimilarity('zwaan', 'zwan');
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });
});

describe('chooseVenueMatch', () => {
  it('koppelt aan dezelfde tent onder een andere spelling', () => {
    const match = chooseVenueMatch({ name: 'Grand Cafe de Zwaan' }, [
      candidate({ name: 'Cafe De Zwaan', distanceM: 28 }),
    ]);
    expect(match?.reason).toBe('exact_normalized_name');
    expect(match?.candidate.name).toBe('Cafe De Zwaan');
  });

  it('koppelt niet aan een tent buiten de radius', () => {
    const justInside = chooseVenueMatch({ name: 'Cafe De Zwaan' }, [
      candidate({ name: 'Cafe De Zwaan', distanceM: DEDUPE_RADIUS_M - 1 }),
    ]);
    const justOutside = chooseVenueMatch({ name: 'Cafe De Zwaan' }, [
      candidate({ name: 'Cafe De Zwaan', distanceM: DEDUPE_RADIUS_M + 1 }),
    ]);
    expect(justInside).not.toBeNull();
    expect(justOutside).toBeNull();
  });

  it('koppelt precies op de radiusgrens nog wel', () => {
    const onBoundary = chooseVenueMatch({ name: 'Cafe De Zwaan' }, [
      candidate({ name: 'Cafe De Zwaan', distanceM: DEDUPE_RADIUS_M }),
    ]);
    expect(onBoundary).not.toBeNull();
  });

  it('koppelt niet aan een andere tent op hetzelfde adres', () => {
    // Twee kroegen naast elkaar is heel normaal; alleen nabijheid is te weinig.
    const match = chooseVenueMatch({ name: 'Het Anker' }, [
      candidate({ name: 'De Zwaan', distanceM: 5 }),
    ]);
    expect(match).toBeNull();
  });

  it('vertrouwt een gelijk osm_id ook buiten de radius', () => {
    // Coordinaten uit OpenStreetMap en van een telefoon-gps kunnen tientallen
    // meters verschillen; hetzelfde osm_id is dan het sterkere signaal.
    const match = chooseVenueMatch({ name: 'De Zwaan', osmId: 12345 }, [
      candidate({ name: 'Iets Heel Anders', distanceM: 400, osmId: 12345 }),
    ]);
    expect(match?.reason).toBe('osm_id');
  });

  it('kiest bij gelijke naam de dichtstbijzijnde', () => {
    const match = chooseVenueMatch({ name: 'De Zwaan' }, [
      candidate({ id: 'ver', name: 'De Zwaan', distanceM: 45 }),
      candidate({ id: 'dichtbij', name: 'De Zwaan', distanceM: 6 }),
    ]);
    expect(match?.candidate.id).toBe('dichtbij');
  });

  it('geeft een exacte naam voorrang boven een gelijkende naam die dichterbij is', () => {
    const match = chooseVenueMatch({ name: 'De Zwaan' }, [
      candidate({ id: 'gelijkend', name: 'De Zwaante', distanceM: 3 }),
      candidate({ id: 'exact', name: 'Cafe de Zwaan', distanceM: 40 }),
    ]);
    expect(match?.candidate.id).toBe('exact');
  });

  it('geeft null bij een lege kandidatenlijst', () => {
    expect(chooseVenueMatch({ name: 'Nieuwe Tent' }, [])).toBeNull();
  });
});

describe('venueLockKey', () => {
  it('geeft dezelfde sleutel voor punten binnen de deduplicatieradius', () => {
    // Twee punten ongeveer veertig meter van elkaar op de Oudegracht.
    expect(venueLockKey(52.09183, 5.11889)).toBe(venueLockKey(52.09214, 5.11912));
  });

  it('geeft verschillende sleutels voor verschillende steden', () => {
    expect(venueLockKey(52.09183, 5.11889)).not.toBe(venueLockKey(52.38712, 4.89013));
  });

  it('blijft binnen het bereik van een 32-bits integer', () => {
    for (const [lat, lon] of [
      [-90, -180],
      [90, 180],
      [0, 0],
    ] as const) {
      const key = venueLockKey(lat, lon);
      expect(Number.isInteger(key)).toBe(true);
      expect(Math.abs(key)).toBeLessThan(2_147_483_647);
    }
  });
});

describe('haversineMeters', () => {
  it('rekent een korte afstand binnen een paar procent goed', () => {
    // Neude naar Janskerkhof in Utrecht is ongeveer 200 meter hemelsbreed.
    const distance = haversineMeters(
      { lat: 52.09456, lon: 5.11962 },
      { lat: 52.09285, lon: 5.12283 },
    );
    expect(distance).toBeGreaterThan(240);
    expect(distance).toBeLessThan(320);
  });

  it('geeft nul voor hetzelfde punt', () => {
    expect(haversineMeters({ lat: 52, lon: 5 }, { lat: 52, lon: 5 })).toBe(0);
  });
});
