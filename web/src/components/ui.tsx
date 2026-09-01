import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../lib/api.js';

/** Kleine, herbruikbare bouwstenen. Bewust geen componentbibliotheek erbij. */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  return (
    <Tag
      className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Titel binnen een kaart, met optioneel een nummer ervoor. */
export function CardTitle({
  step,
  children,
  hint,
}: {
  step?: number;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      {step !== undefined ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-amber-soft font-display text-sm font-bold text-amber-ink">
          {step}
        </span>
      ) : null}
      <div>
        <h2 className="font-display text-base font-semibold text-ink">{children}</h2>
        {hint ? <p className="text-sm text-ink-soft">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
}) {
  const styles: Record<string, string> = {
    // Amber als vlak met donkere tekst: 8:1 contrast, en het is de merkkleur.
    primary: 'bg-amber text-ink hover:bg-amber-hover font-semibold shadow-sm',
    secondary: 'bg-surface text-ink border border-line hover:bg-canvas font-medium',
    success: 'bg-green text-white hover:brightness-95 font-semibold shadow-sm',
    danger: 'bg-coral text-white hover:brightness-95 font-semibold shadow-sm',
    ghost: 'bg-transparent text-ink-soft hover:bg-canvas hover:text-ink font-medium',
  };
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-45 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // min-w-0: zonder dit krimpt een grid-kolom niet onder de intrinsieke
    // breedte van zijn inhoud. Een native <input type="date"> heeft op iOS een
    // vaste minimumbreedte voor dag/maand/jaar plus het kalendericoontje, breder
    // dan de helft van een telefoonscherm. In een grid-cols-2 duwde dat de tweede
    // kolom buiten het scherm; met min-w-0 mag het veld zelf krimpen.
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
}

const inputClasses =
  'w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-amber focus:bg-surface focus:ring-2 focus:ring-amber/25 disabled:opacity-50';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClasses} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClasses} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClasses} ${props.className ?? ''}`} />;
}

export function Spinner({ label = 'Bezig' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-soft" role="status">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-amber"
      />
      {label}
    </div>
  );
}

/** Lege staat, met een handgeschreven regel omdat het anders zo streng staat. */
export function EmptyState({
  title,
  children,
  icon = '🍻',
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 p-8 text-center">
      <div className="mb-2 text-3xl" aria-hidden="true">
        {icon}
      </div>
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children ? (
        <div className="mt-1 font-hand text-lg text-amber-ink">{children}</div>
      ) : null}
    </div>
  );
}

/** Zet een onbekende fout om naar iets dat een mens kan lezen. */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'Geen verbinding met de server. Wat je invulde blijft bewaard.';
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Er ging iets mis.';
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-xl border border-coral/40 bg-coral-soft px-3.5 py-2.5 text-sm text-coral-ink">
      {errorMessage(error)}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-green/40 bg-green-soft px-3.5 py-2.5 text-sm text-green-ink">
      {children}
    </p>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn' | 'good' | 'amber';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-canvas text-ink-soft border-line',
    warn: 'bg-coral-soft text-coral-ink border-coral/30',
    good: 'bg-green-soft text-green-ink border-green/30',
    amber: 'bg-amber-soft text-amber-ink border-amber/40',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Tag als pil, zoals de tags bij een bezoek. */
export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-canvas px-2.5 py-0.5 text-xs text-ink-soft ring-1 ring-line">
      {children}
    </span>
  );
}

/** Initialen in een rondje, voor de aanwezigen bij een bezoek. */
export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      title={name}
      className="grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[0.65rem] font-semibold text-green-ink ring-1 ring-green/25"
    >
      {initials}
    </span>
  );
}

/** Sterren in amber. Halve sterren laten we weg; dat leest niet op een telefoon. */
export function Stars({ rating, className = '' }: { rating: number; className?: string }) {
  const rounded = Math.round(rating);
  return (
    <span className={`text-amber ${className}`} aria-label={`${rating} van 5`}>
      {'★'.repeat(rounded)}
      <span className="text-line-strong">{'★'.repeat(Math.max(0, 5 - rounded))}</span>
    </span>
  );
}
