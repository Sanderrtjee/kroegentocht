/** Weergaveformules op een plek, zodat datums en afstanden er overal gelijk uitzien. */

const dateTimeFormat = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeFormat = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });

const monthFormat = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** "2026-04" naar "april 2026". */
export function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  if (!year || !month) return yearMonth;
  return monthFormat.format(new Date(Number(year), Number(month) - 1, 1));
}

export function formatDistance(meters: number | null): string {
  if (meters === null) return '–';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km`;
}

export function formatRating(rating: number | null): string {
  if (rating === null) return '–';
  return rating.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function stars(rating: number): string {
  const rounded = Math.round(rating);
  return '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded));
}

/** Datum en tijd voor een input[type=datetime-local], in de lokale tijdzone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Waarde uit datetime-local naar een ISO-tijdstempel met tijdzone. */
export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}
