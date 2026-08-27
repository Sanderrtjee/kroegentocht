import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../lib/api.js';

/** Kleine, herbruikbare bouwstenen. Bewust geen componentbibliotheek erbij. */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-nacht-700 bg-nacht-900/70 p-4 shadow-lg shadow-black/20 ${className}`}
    >
      {children}
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
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const styles: Record<string, string> = {
    primary: 'bg-bier-500 text-nacht-950 hover:bg-bier-400 font-semibold',
    secondary: 'bg-nacht-700 text-nacht-200 hover:bg-nacht-600',
    danger: 'bg-red-800 text-red-50 hover:bg-red-700',
    ghost: 'bg-transparent text-nacht-200 hover:bg-nacht-800',
  };
  return (
    <button
      type={type}
      className={`rounded-lg px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
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
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-nacht-200">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-nacht-400">{hint}</span> : null}
    </label>
  );
}

const inputClasses =
  'w-full rounded-lg border border-nacht-700 bg-nacht-950 px-3 py-2 text-nacht-200 outline-none placeholder:text-nacht-600 focus:border-bier-500';

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
    <div className="flex items-center gap-2 text-sm text-nacht-400" role="status">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-nacht-600 border-t-bier-400"
      />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-nacht-700 p-8 text-center">
      <p className="font-medium text-nacht-200">{title}</p>
      {children ? <div className="mt-2 text-sm text-nacht-400">{children}</div> : null}
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
    <p className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
      {errorMessage(error)}
    </p>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn' | 'good';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-nacht-700 text-nacht-200',
    warn: 'bg-amber-900/70 text-amber-100',
    good: 'bg-emerald-900/70 text-emerald-100',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
