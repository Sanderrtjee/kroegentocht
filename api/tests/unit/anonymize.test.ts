import { describe, expect, it } from 'vitest';
import { K_ANONYMITY_THRESHOLD } from '@kroegentocht/shared';
import {
  AnonymityViolationError,
  PUBLIC_FEATURE_FIELDS,
  PUBLIC_REPORT_FIELDS,
  assertNoPersonalFields,
  coarsenToMonth,
  meetsKAnonymity,
  toPublicMapFeature,
  toPublicMapFeatures,
  toPublicReport,
} from '../../src/lib/anonymize.js';

/** Zoals de view public_visit_reports een rij oplevert. */
function reportRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    report_id: '11111111-1111-4111-8111-111111111111',
    venue_id: '22222222-2222-4222-8222-222222222222',
    rating: 4,
    tags: ['bier', 'terras'],
    description: 'Prima tap, druk op vrijdag.',
    visited_month: '2026-04-01',
    ...overrides,
  };
}

/** Zoals de view public_venue_points een rij oplevert. */
function pointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue_id: '22222222-2222-4222-8222-222222222222',
    name: 'De Dorstige Hert',
    city: 'Utrecht',
    lat: 52.09456,
    lon: 5.11962,
    report_count: 5,
    reporter_count: 3,
    avg_rating: '4.40',
    top_tags: ['bier', 'terras'],
    first_month: '2026-03-01',
    last_month: '2026-05-01',
    ...overrides,
  };
}

describe('meetsKAnonymity', () => {
  it('ligt precies op drie melders', () => {
    expect(K_ANONYMITY_THRESHOLD).toBe(3);
    expect(meetsKAnonymity(2)).toBe(false);
    expect(meetsKAnonymity(3)).toBe(true);
    expect(meetsKAnonymity(4)).toBe(true);
  });

  it('weigert onzinnige waarden', () => {
    expect(meetsKAnonymity(Number.NaN)).toBe(false);
    expect(meetsKAnonymity(Number.POSITIVE_INFINITY)).toBe(false);
    expect(meetsKAnonymity(0)).toBe(false);
    expect(meetsKAnonymity(-3)).toBe(false);
  });
});

describe('coarsenToMonth', () => {
  it('brengt een volledige datum terug tot jaar en maand', () => {
    expect(coarsenToMonth('2026-04-19')).toBe('2026-04');
    expect(coarsenToMonth('2026-04-19T23:45:12.000Z')).toBe('2026-04');
  });

  it('werkt ook op een Date, zoals node-postgres die teruggeeft', () => {
    expect(coarsenToMonth(new Date('2026-12-31T22:00:00.000Z'))).toBe('2026-12');
  });

  it('gooit als er iets onverwachts in staat', () => {
    expect(() => coarsenToMonth('vorige maand')).toThrow(AnonymityViolationError);
  });
});

describe('assertNoPersonalFields', () => {
  it('laat een schone rij door', () => {
    expect(() => assertNoPersonalFields(reportRow(), 'test')).not.toThrow();
  });

  it('slaat aan op snake_case en op camelCase', () => {
    expect(() => assertNoPersonalFields({ user_id: 'x' }, 'test')).toThrow(
      AnonymityViolationError,
    );
    expect(() => assertNoPersonalFields({ userId: 'x' }, 'test')).toThrow(
      AnonymityViolationError,
    );
    expect(() => assertNoPersonalFields({ UserId: 'x' }, 'test')).toThrow(
      AnonymityViolationError,
    );
  });

  it('slaat aan op de velden die een melding zouden kunnen herleiden', () => {
    for (const field of ['visited_at', 'photos', 'attendees', 'username', 'ip', 'moderated_by']) {
      expect(() => assertNoPersonalFields({ [field]: 'x' }, 'test'), field).toThrow(
        AnonymityViolationError,
      );
    }
  });
});

describe('toPublicReport', () => {
  it('levert precies de toegestane velden op', () => {
    const dto = toPublicReport(reportRow());
    expect(Object.keys(dto).sort()).toEqual([...PUBLIC_REPORT_FIELDS].sort());
  });

  it('grofkorrelt de datum ook als de bron een volledige tijdstempel aanlevert', () => {
    const dto = toPublicReport(reportRow({ visited_month: '2026-04-19T21:15:00.000Z' }));
    expect(dto.visitedMonth).toBe('2026-04');
  });

  it('weigert een rij waarin een persoonsgegeven is meegeglipt', () => {
    // Dit is het scenario dat we willen uitsluiten: iemand voegt een kolom aan
    // de view toe en de API geeft die zonder nadenken door.
    expect(() => toPublicReport(reportRow({ user_id: 'iemand' }))).toThrow(
      AnonymityViolationError,
    );
    expect(() => toPublicReport(reportRow({ visited_at: '2026-04-19T21:15:00Z' }))).toThrow(
      AnonymityViolationError,
    );
  });

  it('neemt onbekende maar onschuldige extra velden niet over', () => {
    const dto = toPublicReport(reportRow({ irrelevant_column: 'negeer mij' }));
    expect(dto).not.toHaveProperty('irrelevant_column');
    expect(Object.keys(dto)).toHaveLength(PUBLIC_REPORT_FIELDS.length);
  });

  it('gooit als een verplicht veld ontbreekt in plaats van undefined door te geven', () => {
    const row = reportRow();
    delete row.rating;
    expect(() => toPublicReport(row)).toThrow(AnonymityViolationError);
  });
});

describe('toPublicMapFeature', () => {
  it('levert precies de toegestane velden op', () => {
    const dto = toPublicMapFeature(pointRow());
    expect(Object.keys(dto).sort()).toEqual([...PUBLIC_FEATURE_FIELDS].sort());
  });

  it('parseert een numeric die als tekst binnenkomt', () => {
    expect(toPublicMapFeature(pointRow({ avg_rating: '4.40' })).avgRating).toBeCloseTo(4.4);
  });

  it('weigert een tent onder de drempel, ook als de view die zou doorlaten', () => {
    expect(() => toPublicMapFeature(pointRow({ reporter_count: 2 }))).toThrow(
      AnonymityViolationError,
    );
    expect(() => toPublicMapFeature(pointRow({ reporter_count: 1 }))).toThrow(
      AnonymityViolationError,
    );
  });

  it('stelt city op null als de tent geen plaats heeft', () => {
    expect(toPublicMapFeature(pointRow({ city: null })).city).toBeNull();
  });
});

describe('toPublicMapFeatures', () => {
  it('laat rijen onder de drempel stil vallen en houdt de rest', () => {
    const items = toPublicMapFeatures([
      pointRow({ venue_id: '33333333-3333-4333-8333-333333333333', reporter_count: 3 }),
      pointRow({ venue_id: '44444444-4444-4444-8444-444444444444', reporter_count: 2 }),
      pointRow({ venue_id: '55555555-5555-4555-8555-555555555555', reporter_count: 9 }),
    ]);
    expect(items.map((i) => i.reporterCount)).toEqual([3, 9]);
  });

  it('gooit nog wel bij een echte schending', () => {
    expect(() =>
      toPublicMapFeatures([pointRow({ reporter_count: 4, user_id: 'iemand' })]),
    ).toThrow(AnonymityViolationError);
  });

  it('geeft een lege lijst terug als niets de drempel haalt', () => {
    expect(toPublicMapFeatures([pointRow({ reporter_count: 1 })])).toEqual([]);
  });
});
