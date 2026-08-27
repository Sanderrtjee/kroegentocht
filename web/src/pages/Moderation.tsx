import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModerationItemDto } from '@kroegentocht/shared';
import { api, query } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { Badge, Button, Card, EmptyState, ErrorText, Select, Spinner } from '../components/ui.js';

/**
 * Moderatiewachtrij.
 *
 * Een moderator ziet de gemelde tekst en bij welke tent die hoort, en verder
 * niets. Wie de melding schreef staat niet in dit antwoord, want anders zou een
 * moderator de anonimiteit kunnen opheffen.
 */
export function ModerationPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('open');

  const queue = useQuery({
    queryKey: ['moderation-queue', status],
    queryFn: () =>
      api.get<{ items: ModerationItemDto[] }>(
        `/api/moderation/queue${query({ status, limit: 100 })}`,
      ),
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'hide' | 'unhide' | 'dismiss' }) =>
      api.post<unknown>(`/api/moderation/reports/${input.id}/action`, { action: input.action }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['moderation-queue'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-nacht-200">Moderatie</h1>
        <Select
          className="max-w-48"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="open">Openstaand</option>
          <option value="hidden">Verborgen</option>
          <option value="dismissed">Afgewezen</option>
          <option value="all">Alles</option>
        </Select>
      </div>

      <p className="text-sm text-nacht-400">
        Verbergen haalt de tekst uit de publieke laag en uit de aggregaten. Het bezoek zelf blijft
        van de eigenaar; die ziet het nog gewoon in zijn eigen overzicht.
      </p>

      {queue.isLoading ? <Spinner label="Wachtrij ophalen" /> : null}
      <ErrorText error={queue.error ?? act.error} />

      {queue.data && queue.data.items.length === 0 ? (
        <EmptyState title="Niets te doen">Er staan geen meldingen in deze categorie.</EmptyState>
      ) : null}

      <div className="space-y-3">
        {queue.data?.items.map((item) => (
          <Card key={item.contentReportId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-nacht-200">{item.venueName}</span>
              <span className="flex items-center gap-2 text-xs text-nacht-400">
                {formatDateTime(item.createdAt)}
                <Badge tone={item.hidden ? 'warn' : 'neutral'}>
                  {item.hidden ? 'verborgen' : item.status}
                </Badge>
              </span>
            </div>

            <p className="mt-2 rounded-lg bg-nacht-950 px-3 py-2 text-sm whitespace-pre-wrap">
              {item.description || <span className="text-nacht-600">(geen tekst)</span>}
            </p>

            <p className="mt-2 text-sm text-nacht-400">
              <span className="font-medium text-nacht-200">Reden van de melder: </span>
              {item.reason}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {item.hidden ? (
                <Button
                  variant="secondary"
                  onClick={() => act.mutate({ id: item.contentReportId, action: 'unhide' })}
                  disabled={act.isPending}
                >
                  Weer zichtbaar maken
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={() => act.mutate({ id: item.contentReportId, action: 'hide' })}
                  disabled={act.isPending}
                >
                  Tekst verbergen
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => act.mutate({ id: item.contentReportId, action: 'dismiss' })}
                disabled={act.isPending}
              >
                Melding afwijzen
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
