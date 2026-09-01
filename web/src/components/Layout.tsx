import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { flushQueue } from '../lib/offline-queue.js';
import { useQueue } from '../lib/useQueue.js';
import { Button } from './ui.js';

const NAV = [
  { to: '/', label: 'Vastleggen' },
  { to: '/kaart', label: 'Kaart' },
  { to: '/bezoeken', label: 'Bezoeken' },
  { to: '/tochten', label: 'Tochten' },
  { to: '/statistiek', label: 'Statistiek' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { items, online } = useQueue();
  const navigate = useNavigate();

  const isModerator = user?.role === 'moderator' || user?.role === 'admin';

  return (
    <div className="flex min-h-full flex-col">
      {/* Statusbalk: in een kroeg is dit het belangrijkste stukje van de app. */}
      {(!online || items.length > 0) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm ${
            online ? 'bg-amber-900/80 text-amber-50' : 'bg-nacht-700 text-nacht-200'
          }`}
        >
          <span>
            {online
              ? `${items.length} bezoek${items.length === 1 ? '' : 'en'} wacht${items.length === 1 ? '' : 'en'} op verzending.`
              : `Offline. ${items.length} bezoek${items.length === 1 ? '' : 'en'} in de wachtrij, niets gaat verloren.`}
          </span>
          {online && items.length > 0 ? (
            <Button variant="secondary" onClick={() => void flushQueue({ includeFailed: true })}>
              Nu versturen
            </Button>
          ) : null}
        </div>
      )}

      <header className="border-b border-nacht-800 bg-nacht-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-semibold text-bier-400">Kroegentocht</span>
          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm ${
                    isActive
                      ? 'bg-nacht-700 text-nacht-200'
                      : 'text-nacht-400 hover:bg-nacht-800 hover:text-nacht-200'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {isModerator ? (
              <NavLink
                to="/moderatie"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm ${
                    isActive
                      ? 'bg-nacht-700 text-nacht-200'
                      : 'text-nacht-400 hover:bg-nacht-800 hover:text-nacht-200'
                  }`
                }
              >
                Moderatie
              </NavLink>
            ) : null}
          </nav>
          <div className="flex items-center gap-2 text-sm text-nacht-400">
            <NavLink to="/instellingen" className="hover:text-nacht-200">
              {user?.username}
            </NavLink>
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
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        <Outlet />
      </main>

      <footer className="border-t border-nacht-800 px-4 py-3 text-center text-xs text-nacht-600">
        Zelf gehost. Kaartdata &copy; OpenStreetMap-bijdragers, ODbL.
      </footer>
    </div>
  );
}
