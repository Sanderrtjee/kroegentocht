import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.js';
import { AuthProvider } from './lib/auth.js';
import { startQueueWorker } from './lib/offline-queue.js';
import './index.css';

/**
 * De service worker wordt hier geregistreerd en niet met een inline scriptje in
 * index.html. De Content Security Policy staat script-src op 'self' zonder
 * uitzonderingen, dus inline scripts worden geweigerd.
 */
registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Op een slechte verbinding is een oud antwoord bruikbaarder dan een
      // leeg scherm, en de service worker houdt leesverzoeken toch al vast.
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

// De offline wachtrij blijft in de achtergrond proberen te versturen.
startQueueWorker();

const container = document.getElementById('root');
if (!container) throw new Error('Element #root niet gevonden.');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
