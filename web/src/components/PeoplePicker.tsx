import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PersonDto } from '@kroegentocht/shared';
import { api } from '../lib/api.js';
import { TextInput } from './ui.js';

export interface AttendeeSelection {
  personId?: string;
  name?: string;
  remember: boolean;
  /** Alleen voor de weergave. */
  label: string;
}

/**
 * Aanwezigen kiezen uit de eigen maatjeslijst, of een nieuwe naam toevoegen.
 *
 * Een nieuwe naam wordt standaard onthouden, want dat is het hele nut van de
 * lijst: de tweede keer klik je Bram aan. Wie er eenmalig bij was kan het vinkje
 * uitzetten; die naam hangt dan alleen aan dit bezoek.
 */
export function PeoplePicker({
  value,
  onChange,
}: {
  value: AttendeeSelection[];
  onChange: (value: AttendeeSelection[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(true);

  const people = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get<{ items: PersonDto[] }>('/api/people'),
    staleTime: 60_000,
  });

  const selectedIds = new Set(value.map((v) => v.personId).filter(Boolean));

  const toggle = (person: PersonDto) => {
    if (selectedIds.has(person.id)) {
      onChange(value.filter((v) => v.personId !== person.id));
    } else {
      onChange([...value, { personId: person.id, remember: true, label: person.name }]);
    }
  };

  const addName = () => {
    const name = draft.trim();
    if (name.length === 0) return;
    const existing = people.data?.items.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      if (!selectedIds.has(existing.id)) toggle(existing);
    } else if (!value.some((v) => v.label.toLowerCase() === name.toLowerCase())) {
      onChange([...value, { name, remember, label: name }]);
    }
    setDraft('');
  };

  return (
    <div>
      {people.data && people.data.items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {people.data.items.map((person) => {
            const active = selectedIds.has(person.id);
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => toggle(person)}
                className={`rounded-full px-3 py-1 text-sm ${
                  active
                    ? 'bg-bier-500 font-medium text-nacht-950'
                    : 'bg-nacht-700 text-nacht-200 hover:bg-nacht-600'
                }`}
              >
                {person.name}
                {person.visitCount > 0 && !active ? (
                  <span className="ml-1 text-xs text-nacht-400">{person.visitCount}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-nacht-400">
          Nog geen maatjes in je lijst. Typ hieronder een naam.
        </p>
      )}

      {/* Namen die nog niet in de lijst staan. */}
      {value.filter((v) => !v.personId).length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value
            .filter((v) => !v.personId)
            .map((entry) => (
              <span
                key={entry.label}
                className="flex items-center gap-1 rounded-full border border-bier-500/60 px-2.5 py-1 text-sm"
              >
                {entry.label}
                {!entry.remember ? (
                  <span className="text-xs text-nacht-400">(eenmalig)</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== entry))}
                  className="text-nacht-400 hover:text-red-300"
                  aria-label={`${entry.label} verwijderen`}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TextInput
          className="max-w-56"
          value={draft}
          placeholder="Naam toevoegen"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addName();
            }
          }}
        />
        <label className="flex items-center gap-1.5 text-sm text-nacht-400">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Onthouden in mijn lijst
        </label>
      </div>
    </div>
  );
}
