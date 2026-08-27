import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { Spinner } from './components/ui.js';
import { useAuth } from './lib/auth.js';
import { LoginPage, RegisterPage } from './pages/Auth.js';
import { CrawlDetailPage, CrawlsPage } from './pages/Crawls.js';
import { MapPage } from './pages/MapPage.js';
import { ModerationPage } from './pages/Moderation.js';
import { NewVisitPage } from './pages/NewVisit.js';
import { SettingsPage } from './pages/Settings.js';
import { StatsPage } from './pages/Stats.js';
import { VisitDetailPage, VisitsPage } from './pages/Visits.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-full place-items-center">
        <Spinner label="Sessie controleren" />
      </div>
    );
  }
  if (!user) return <Navigate to="/inloggen" replace />;
  return <>{children}</>;
}

function RequireModerator({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'moderator' && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/inloggen" element={<LoginPage />} />
      <Route path="/registreren" element={<RegisterPage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<NewVisitPage />} />
        <Route path="/kaart" element={<MapPage />} />
        <Route path="/bezoeken" element={<VisitsPage />} />
        <Route path="/bezoeken/:id" element={<VisitDetailPage />} />
        <Route path="/tochten" element={<CrawlsPage />} />
        <Route path="/tochten/:id" element={<CrawlDetailPage />} />
        <Route path="/statistiek" element={<StatsPage />} />
        <Route path="/instellingen" element={<SettingsPage />} />
        <Route
          path="/moderatie"
          element={
            <RequireModerator>
              <ModerationPage />
            </RequireModerator>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
