import { useEffect, useState } from 'react';
import { listQueue, subscribeQueue, type QueuedVisit } from './offline-queue.js';

/** Houdt de offline wachtrij bij, zodat de balk bovenin altijd klopt. */
export function useQueue(): { items: QueuedVisit[]; online: boolean } {
  const [items, setItems] = useState<QueuedVisit[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listQueue().then((next) => {
        if (active) setItems(next);
      });
    };

    refresh();
    const unsubscribe = subscribeQueue(refresh);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return { items, online };
}
