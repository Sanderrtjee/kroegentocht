import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Button, Card, ErrorText, Field, TextInput } from '../components/ui.js';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-amber-ink">Kroegentocht</h1>
        <p className="text-sm text-ink-soft">{title}</p>
      </div>
      <Card>{children}</Card>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Inloggen">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Gebruikersnaam">
          <TextInput
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </Field>
        <Field label="Wachtwoord">
          <TextInput
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Inloggen…' : 'Inloggen'}
        </Button>
        <p className="text-center text-sm text-ink-soft">
          Uitnodiging gekregen?{' '}
          <Link to="/registreren" className="text-amber-ink underline">
            Account aanmaken
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery({
    queryKey: ['registration-status'],
    queryFn: () =>
      api.get<{ enabled: boolean; inviteRequired: boolean }>('/api/auth/registration-status'),
    retry: false,
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(username, password, inviteCode);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (status.data && !status.data.enabled) {
    return (
      <AuthShell title="Account aanmaken">
        <p className="text-sm text-ink-soft">
          Registratie staat uit op deze server. Vraag de beheerder om een account.
        </p>
        <Link to="/inloggen" className="mt-3 inline-block text-amber-ink underline">
          Terug naar inloggen
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Account aanmaken">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Uitnodigingscode" hint="Die krijg je van de beheerder van deze server.">
          <TextInput
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            required
          />
        </Field>
        <Field label="Gebruikersnaam" hint="3 tot 32 tekens, letters, cijfers, punt, - en _.">
          <TextInput
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={3}
            maxLength={32}
          />
        </Field>
        <Field label="Wachtwoord" hint="Minimaal 12 tekens.">
          <TextInput
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Aanmaken…' : 'Account aanmaken'}
        </Button>
        <p className="text-center text-sm text-ink-soft">
          <Link to="/inloggen" className="text-amber-ink underline">
            Ik heb al een account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
