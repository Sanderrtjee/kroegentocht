import { useState } from 'react';
import { PRICE_LABELS } from '@kroegentocht/shared';
import { TextInput } from './ui.js';

/** Rating van 1 tot 5. Radiobuttons onder water, dus toetsenbord en
 *  schermlezer werken zonder extra werk. */
export function RatingInput({
  value,
  onChange,
  name = 'rating',
}: {
  value: number;
  onChange: (value: number) => void;
  name?: string;
}) {
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">Waardering</legend>
      {[1, 2, 3, 4, 5].map((score) => (
        <label
          key={score}
          className={`cursor-pointer rounded-lg px-2 py-1 text-xl transition-colors ${
            score <= value ? 'text-amber-ink' : 'text-ink-faint hover:text-ink-soft'
          }`}
          title={`${score} van 5`}
        >
          <input
            type="radio"
            name={name}
            value={score}
            checked={value === score}
            onChange={() => onChange(score)}
            className="sr-only"
          />
          {score <= value ? '★' : '☆'}
        </label>
      ))}
      <span className="ml-2 text-sm text-ink-soft">{value} van 5</span>
    </fieldset>
  );
}

export function PriceInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {[1, 2, 3, 4].map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => onChange(value === level ? null : level)}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            value === level
              ? 'bg-amber font-medium text-ink'
              : 'bg-canvas text-ink ring-1 ring-line hover:bg-surface'
          }`}
        >
          {'€'.repeat(level)} {PRICE_LABELS[level]}
        </button>
      ))}
    </div>
  );
}

/** Tags als losse blokjes; komma of enter voegt toe. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  max = 12,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions?: string[];
  max?: number;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag.length === 0 || tag.length > 30) return;
    if (value.includes(tag) || value.length >= max) return;
    onChange([...value, tag]);
  };

  const unused = suggestions.filter((s) => !value.includes(s)).slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-canvas px-2.5 py-1 text-sm text-ink ring-1 ring-line"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-ink-soft hover:text-coral-ink"
              aria-label={`Tag ${tag} verwijderen`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <TextInput
        className="mt-2"
        value={draft}
        placeholder={value.length >= max ? 'Maximum bereikt' : 'Tag en dan enter'}
        disabled={value.length >= max}
        onChange={(event) => {
          const next = event.target.value;
          if (next.endsWith(',')) {
            add(next.slice(0, -1));
            setDraft('');
          } else {
            setDraft(next);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add(draft);
            setDraft('');
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
      {unused.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {unused.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-soft hover:border-amber hover:text-amber-ink"
            >
              + {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
