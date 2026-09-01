import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { flushQueue } from '../lib/offline-queue.js';
import { useQueue } from '../lib/useQueue.js';
import { Button } from './ui.js';

/**
 * Navigatie.
 *
 * Op een telefoon staat de navigatie onderaan, binnen duimbereik, met
 * Vastleggen als opvallende middelste knop. Dat is niet alleen mode: de oude
 * variant liep als een menubalk over drie regels op een telefoon, en vastleggen
 * is nu eenmaal wat je in een kroeg doet. Vanaf md staat dezelfde navigatie in
 * de koptekst en verdwijnt de balk onderaan.
 */

const iconClass = 'size-5 shrink-0';

function IconHome() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 20V11m7 9V5m7 15v-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMap() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function IconList() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 6h11M8 12h11M8 18h11"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <circle cx="4.2" cy="6" r="1.4" fill="currentColor" />
      <circle cx="4.2" cy="12" r="1.4" fill="currentColor" />
      <circle cx="4.2" cy="18" r="1.4" fill="currentColor" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="18" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M8.6 17.2c4-.6 4.6-2 4.6-4.2 0-2.4 1-3.6 2.4-4.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeDasharray="2.6 2.6"
      />
    </svg>
  );
}

/** Het bierglas naast het woordmerk. */
function Wordmark() {
  return (
    <NavLink to="/" className="flex items-center gap-2">
      {/* Pul met schuim: body in amber, oor en omlijning in de donkere variant. */}
      <svg className="size-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6.4 8.4h9.2v9.1a3 3 0 0 1-3 3H9.4a3 3 0 0 1-3-3Z"
          fill="var(--color-amber)"
          stroke="var(--color-amber-ink)"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M15.9 11h1.7a2.2 2.2 0 0 1 2.2 2.2v1.6a2.2 2.2 0 0 1-2.2 2.2h-1.7"
          stroke="var(--color-amber-ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M6.4 8.4a2.5 2.5 0 0 1 2.5-2.5c.4-1.2 2.3-1.2 2.7 0a2.5 2.5 0 0 1 4 2.5Z"
          fill="var(--color-surface)"
          stroke="var(--color-amber-ink)"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight text-ink">
        Kroegen<span className="text-amber-ink">tocht</span>
      </span>
    </NavLink>
  );
}

const NAV = [
  { to: '/', label: 'Thuis', icon: IconHome, end: true },
  { to: '/kaart', label: 'Kaart', icon: IconMap, end: false },
  { to: '/bezoeken', label: 'Bezoeken', icon: IconList, end: false },
  { to: '/tochten', label: 'Tochten', icon: IconRoute, end: false },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { items, online } = useQueue();
  const navigate = useNavigate();

  const isModerator = user?.role === 'moderator' || user?.role === 'admin';
  const waiting = items.length;

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      {/* Statusbalk: in een kroeg is dit het belangrijkste stukje van de app. */}
      {(!online || waiting > 0) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm ${
            online
              ? 'bg-amber-soft text-amber-ink'
              : 'bg-canvas text-ink-soft ring-1 ring-line'
          }`}
        >
          <span>
            {online
              ? `${waiting} bezoek${waiting === 1 ? '' : 'en'} wacht${waiting === 1 ? '' : 'en'} op verzending.`
              : `Offline. ${waiting} bezoek${waiting === 1 ? '' : 'en'} in de wachtrij, niets gaat verloren.`}
          </span>
          {online && waiting > 0 ? (
            <Button
              variant="secondary"
              className="min-h-9 py-1.5"
              onClick={() => void flushQueue({ includeFailed: true })}
            >
              Nu versturen
            </Button>
          ) : null}
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Wordmark />

          {/* Vanaf md staat de navigatie hier; op een telefoon onderaan. */}
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-amber-soft text-amber-ink'
                      : 'text-ink-soft hover:bg-canvas hover:text-ink'
                  }`
                }
              >
                <item.icon />
                {item.label}
              </NavLink>
            ))}
            <NavLink
              to="/vastleggen"
              className="ml-1 flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 py-2 text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-amber-hover"
            >
              <IconPlus />
              Vastleggen
            </NavLink>
          </nav>

          {/*
            Op een telefoon staat hier alleen de avatar. Moderatie en uitloggen
            zitten dan achter die avatar, op de instellingenpagina: met alle drie
            in de koptekst liep de balk buiten beeld. De display-klasse staat op
            een wrapper en niet op de knop zelf, want 'hidden' en 'inline-flex'
            zijn beide display-utilities en dan bepaalt de volgorde in de
            gegenereerde CSS wie wint, niet de volgorde in het class-attribuut.
          */}
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            {isModerator ? (
              <div className="hidden md:block">
                <NavLink
                  to="/moderatie"
                  className={({ isActive }) =>
                    `rounded-xl px-3 py-2 text-sm font-medium ${
                      isActive ? 'bg-amber-soft text-amber-ink' : 'text-ink-soft hover:text-ink'
                    }`
                  }
                >
                  Moderatie
                </NavLink>
              </div>
            ) : null}
            <NavLink
              to="/instellingen"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-green-soft font-semibold text-green-ink ring-1 ring-green/25"
              title={`Ingelogd als ${user?.username}`}
            >
              {user?.username?.slice(0, 2).toUpperCase()}
            </NavLink>
            <div className="hidden md:block">
              <Button
                variant="ghost"
                onClick={() => {
                  void logout().then(() => navigate('/inloggen'));
                }}
              >
                Uitloggen
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 pb-28 md:pb-8">
        <Outlet />
      </main>

      <footer className="hidden px-4 py-4 text-center text-xs text-ink-faint md:block">
        Zelf gehost. Kaartdata &copy; OpenStreetMap-bijdragers, ODbL.
      </footer>

      {/* Tabbalk onderaan, alleen op een telefoon. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-end justify-around px-2 py-1.5">
          {NAV.slice(0, 2).map((item) => (
            <TabLink key={item.to} {...item} />
          ))}

          <NavLink
            to="/vastleggen"
            aria-label="Bezoek vastleggen"
            className={({ isActive }) =>
              `-mt-6 grid size-14 place-items-center rounded-full text-ink shadow-lift transition-transform active:scale-95 ${
                isActive ? 'bg-amber-hover' : 'bg-amber'
              }`
            }
          >
            <IconPlus />
          </NavLink>

          {NAV.slice(2).map((item) => (
            <TabLink key={item.to} {...item} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function TabLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: () => React.JSX.Element;
  end: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[0.7rem] font-medium transition-colors ${
          isActive ? 'text-amber-ink' : 'text-ink-faint'
        }`
      }
    >
      <Icon />
      {label}
    </NavLink>
  );
}
