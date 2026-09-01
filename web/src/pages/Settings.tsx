import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { K_ANONYMITY_THRESHOLD } from '@kroegentocht/shared';
import type { FriendDto, PersonDto } from '@kroegentocht/shared';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useQueue } from '../lib/useQueue.js';
import { flushQueue, removeFromQueue } from '../lib/offline-queue.js';
import { Badge, Button, Card, ErrorText, Field, Spinner, TextInput } from '../components/ui.js';

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-nacht-200">Instellingen</h1>
      <p className="text-sm text-nacht-400">
        Ingelogd als {user?.username} ({user?.role}).
      </p>

      <QueueSection />
      <PeopleSection />
      <FriendsSection />
      <ExportSection />
      <PasswordSection />
      <DeleteAccountSection />
    </div>
  );
}

function QueueSection() {
  const { items, online } = useQueue();

  return (
    <Card>
      <h2 className="font-medium text-nacht-200">Offline wachtrij</h2>
      <p className="mt-1 text-sm text-nacht-400">
        Bezoeken worden eerst op dit toestel opgeslagen en daarna verstuurd. {online ? 'Er is verbinding.' : 'Er is nu geen verbinding.'}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-nacht-400">De wachtrij is leeg.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-nacht-700 p-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {item.payload.venue?.name ?? 'Bestaande tent'}
                </span>
                <span className="text-xs text-nacht-400">
                  {item.photos.length} foto{item.photos.length === 1 ? '' : 's'} ·{' '}
                  {item.attempts} poging{item.attempts === 1 ? '' : 'en'}
                </span>
              </div>
              {item.lastError ? (
                <p className="mt-1 text-xs text-amber-300">{item.lastError}</p>
              ) : null}
              <button
                type="button"
                className="mt-1 text-xs text-nacht-400 underline hover:text-red-300"
                onClick={() => {
                  if (window.confirm('Dit bezoek uit de wachtrij gooien? Het is dan weg.')) {
                    void removeFromQueue(item.id);
                  }
                }}
              >
                Uit de wachtrij verwijderen
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void flushQueue({ includeFailed: true })} disabled={!online}>
            Nu proberen te versturen
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function PeopleSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const people = useQuery({
    queryKey: ['people'],
    queryFn: () => api.get<{ items: PersonDto[] }>('/api/people'),
  });

  const create = useMutation({
    mutationFn: () => api.post<PersonDto>('/api/people', { name: name.trim() }),
    onSuccess: async () => {
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/people/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });

  return (
    <Card>
      <h2 className="font-medium text-nacht-200">Mijn maatjes</h2>
      <p className="mt-1 text-sm text-nacht-400">
        Deze namen zijn alleen voor jou zichtbaar en verdwijnen mee als je je account verwijdert.
      </p>
      {people.isLoading ? <Spinner /> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {people.data?.items.map((person) => (
          <span
            key={person.id}
            className="flex items-center gap-1.5 rounded-full bg-nacht-700 px-3 py-1 text-sm"
          >
            {person.name}
            <span className="text-xs text-nacht-400">{person.visitCount}</span>
            <button
              type="button"
              className="text-nacht-400 hover:text-red-300"
              aria-label={`${person.name} verwijderen`}
              onClick={() => {
                if (
                  window.confirm(
                    `${person.name} verwijderen? De naam verdwijnt ook bij eerdere bezoeken.`,
                  )
                ) {
                  remove.mutate(person.id);
                }
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <TextInput
          className="max-w-56"
          value={name}
          maxLength={80}
          placeholder="Naam"
          onChange={(event) => setName(event.target.value)}
        />
        <Button onClick={() => create.mutate()} disabled={name.trim().length === 0}>
          Toevoegen
        </Button>
      </div>
      <ErrorText error={create.error ?? remove.error} />
    </Card>
  );
}

function FriendsSection() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');

  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<{ items: FriendDto[] }>('/api/friends'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['friends'] });

  const request = useMutation({
    mutationFn: () => api.post<unknown>('/api/friends', { username: username.trim() }),
    onSuccess: async () => {
      setUsername('');
      await invalidate();
    },
  });

  const respond = useMutation({
    mutationFn: (input: { id: string; accept: boolean }) =>
      api.post<unknown>(`/api/friends/${input.id}/respond`, { accept: input.accept }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/friends/${id}`),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <h2 className="font-medium text-nacht-200">Vrienden</h2>
      <p className="mt-1 text-sm text-nacht-400">
        Alleen geaccepteerde vrienden zien bezoeken met de zichtbaarheid "ik en mijn vrienden".
        Anonieme meldingen blijven ook voor hen anoniem.
      </p>
      {friends.isLoading ? <Spinner /> : null}
      <ul className="mt-2 space-y-1">
        {friends.data?.items.map((friend) => (
          <li
            key={friend.friendshipId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-nacht-700 px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              {friend.username}
              {friend.status === 'pending' ? (
                <Badge tone="warn">
                  {friend.direction === 'incoming' ? 'wil je toevoegen' : 'verzoek verstuurd'}
                </Badge>
              ) : (
                <Badge tone="good">vrienden</Badge>
              )}
            </span>
            <span className="flex gap-2">
              {friend.status === 'pending' && friend.direction === 'incoming' ? (
                <Button
                  onClick={() => respond.mutate({ id: friend.friendshipId, accept: true })}
                >
                  Accepteren
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => remove.mutate(friend.friendshipId)}>
                Verwijderen
              </Button>
            </span>
          </li>
        ))}
        {friends.data && friends.data.items.length === 0 ? (
          <li className="text-sm text-nacht-400">Nog geen vrienden of verzoeken.</li>
        ) : null}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <TextInput
          className="max-w-56"
          value={username}
          placeholder="Gebruikersnaam"
          autoCapitalize="none"
          onChange={(event) => setUsername(event.target.value)}
        />
        <Button onClick={() => request.mutate()} disabled={username.trim().length === 0}>
          Verzoek versturen
        </Button>
      </div>
      <ErrorText error={request.error ?? respond.error ?? remove.error} />
    </Card>
  );
}

function ExportSection() {
  return (
    <Card>
      <h2 className="font-medium text-nacht-200">Mijn data exporteren</h2>
      <p className="mt-1 text-sm text-nacht-400">
        De JSON bevat je bezoeken, maatjes en tochten. De zip bevat je fotos zoals ze op de server
        staan: hergecodeerd naar webp en zonder metadata.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {/* Gewone links, zodat de browser het downloaden zelf doet en de
            sessiecookie meegaat. */}
        <a
          href="/api/export/json"
          className="rounded-lg bg-nacht-700 px-4 py-2 text-sm hover:bg-nacht-600"
        >
          Alles als JSON
        </a>
        <a
          href="/api/export/photos.zip"
          className="rounded-lg bg-nacht-700 px-4 py-2 text-sm hover:bg-nacht-600"
        >
          Fotos als zip
        </a>
      </div>
    </Card>
  );
}

function PasswordSection() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const change = useMutation({
    mutationFn: () =>
      api.post<{ reloginRequired: boolean }>('/api/me/password', {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      // Alle sessies zijn ingetrokken, dus opnieuw inloggen.
      navigate('/inloggen');
    },
  });

  return (
    <Card>
      <h2 className="font-medium text-nacht-200">Wachtwoord wijzigen</h2>
      <p className="mt-1 text-sm text-nacht-400">
        Alle sessies worden daarna afgemeld, ook op je andere toestellen.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Huidig wachtwoord">
          <TextInput
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Field label="Nieuw wachtwoord" hint="Minimaal 12 tekens.">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Button
          onClick={() => change.mutate()}
          disabled={current.length === 0 || next.length < 12 || change.isPending}
        >
          Wachtwoord wijzigen
        </Button>
      </div>
      <ErrorText error={change.error} />
    </Card>
  );
}

function DeleteAccountSection() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');

  const remove = useMutation({
    mutationFn: () =>
      api.del<{ deleted: boolean; photosRemoved: number }>('/api/me', {
        confirmUsername: confirmName,
        password,
      }),
    onSuccess: async () => {
      await logout().catch(() => undefined);
      navigate('/inloggen');
    },
  });

  return (
    <Card className="border-red-900/70">
      <h2 className="font-medium text-red-200">Account verwijderen</h2>
      <div className="mt-1 space-y-2 text-sm text-nacht-400">
        <p>
          Dit verwijdert onherroepelijk: je account, je bezoeken, je fotobestanden, je maatjes, je
          tochten, je vriendschappen en je sessies. Ook je anonieme meldingen verdwijnen, want dat
          zijn dezelfde rijen.
        </p>
        <p>
          Wat blijft staan: de tenten zelf, want een kroeg is geen persoonsgegeven. Van jou blijft
          daar niets aan hangen. En de regels in het auditlogboek blijven bestaan zonder verwijzing
          naar jou.
        </p>
        <p>
          Doordat je meldingen verdwijnen kan een tent onder de {K_ANONYMITY_THRESHOLD} melders
          zakken en van de publieke kaart verdwijnen. Dat is de bedoeling.
        </p>
        <p>Exporteer eerst je data als je die wilt houden.</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={`Typ je gebruikersnaam (${user?.username})`}>
          <TextInput
            value={confirmName}
            autoCapitalize="none"
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </Field>
        <Field label="Wachtwoord">
          <TextInput
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Button
          variant="danger"
          disabled={
            confirmName.toLowerCase() !== (user?.username ?? '').toLowerCase() ||
            password.length === 0 ||
            remove.isPending
          }
          onClick={() => {
            if (window.confirm('Definitief alles verwijderen? Dit kan niet ongedaan gemaakt worden.')) {
              remove.mutate();
            }
          }}
        >
          Alles verwijderen
        </Button>
      </div>
      <ErrorText error={remove.error} />
    </Card>
  );
}
