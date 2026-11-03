import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatchRun, MatchRunEvent } from '@trialmatch/shared';
import { useEffect } from 'react';
import { api, streamEvents } from '../../lib/api';

export const matchKeys = {
  runs: (patientId: number) => ['patients', patientId, 'match-runs'] as const,
};

export const isActive = (run?: MatchRun) =>
  run?.status === 'queued' || run?.status === 'running';

export function useMatchRuns(patientId: number) {
  return useQuery({
    queryKey: matchKeys.runs(patientId),
    queryFn: () => api<MatchRun[]>(`/patients/${patientId}/match-runs`),
  });
}

export function useStartMatch(patientId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<MatchRun>(`/patients/${patientId}/match-runs`, { method: 'POST' }),
    onSuccess: (run) =>
      qc.setQueryData<MatchRun[]>(matchKeys.runs(patientId), (runs = []) => [
        run,
        ...runs,
      ]),
  });
}

const rank = (r: MatchRun) =>
  r.status === 'succeeded' || r.status === 'failed'
    ? 2
    : r.status === 'running'
      ? 1
      : 0;

/**
 * While a run is queued or running, follow its live progress (Server-Sent Events)
 * and keep the cached run up to date. Reconnects if the stream drops.
 */
export function useFollowRun(patientId: number, run?: MatchRun) {
  const qc = useQueryClient();
  const runId = run?.id;
  const active = isActive(run);

  useEffect(() => {
    if (!runId || !active) return;
    const controller = new AbortController();
    const update = (next: MatchRun) =>
      qc.setQueryData<MatchRun[]>(matchKeys.runs(patientId), (runs = []) =>
        runs.map((r) =>
          r.id !== next.id
            ? r
            : rank(next) > rank(r) ||
                next.progress >= r.progress ||
                rank(next) === 2
              ? next
              : r,
        ),
      );

    const follow = async (retries: number): Promise<void> => {
      try {
        await streamEvents<MatchRunEvent | { type: 'ping' }>(
          `/match-runs/${runId}/events`,
          (event) => event.type === 'run' && update(event.run),
          controller.signal,
        );
      } catch {
        if (controller.signal.aborted || retries <= 0) return;
        await new Promise((r) => setTimeout(r, 1000));
        return follow(retries - 1);
      }
    };
    void follow(3);
    return () => controller.abort();
  }, [runId, active, patientId, qc]);
}
