import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MatchResult,
  MatchReviewInput,
  MatchRun,
  MatchRunEvent,
  MatchRunKind,
} from '@trialmatch/shared';
import { useEffect } from 'react';
import { api, download, streamEvents } from '../../lib/api';

/**
 * What a run is for (Week 7): find trials for a patient, or find patients for a
 * trial. Both use the same runs, live progress and reviews.
 */
export interface MatchSubject {
  kind: MatchRunKind;
  id: number;
}

const basePath = (s: MatchSubject) =>
  `/${s.kind === 'patient' ? 'patients' : 'trials'}/${s.id}`;

export const matchKeys = {
  runs: (s: MatchSubject) =>
    [s.kind === 'patient' ? 'patients' : 'trials', s.id, 'match-runs'] as const,
};

export const isActive = (run?: MatchRun) =>
  run?.status === 'queued' || run?.status === 'running';

export function useMatchRuns(subject: MatchSubject) {
  return useQuery({
    queryKey: matchKeys.runs(subject),
    queryFn: () => api<MatchRun[]>(`${basePath(subject)}/match-runs`),
  });
}

export function useStartMatch(subject: MatchSubject) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<MatchRun>(`${basePath(subject)}/match-runs`, { method: 'POST' }),
    onSuccess: (run) =>
      qc.setQueryData<MatchRun[]>(matchKeys.runs(subject), (runs = []) => [
        run,
        ...runs,
      ]),
  });
}

/**
 * Week 6: shortlist, dismiss or annotate a match. A review belongs to the
 * patient–trial pair (Week 7), so every cached result of the pair updates in
 * place, and the other side's runs are refetched when next shown.
 */
export function useReviewMatch(subject: MatchSubject) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...review }: MatchReviewInput & { id: number }) =>
      api<MatchResult>(`/match-results/${id}`, {
        method: 'PATCH',
        body: review,
      }),
    onSuccess: (saved) => {
      const { decision, note, decidedAt } = saved;
      qc.setQueryData<MatchRun[]>(matchKeys.runs(subject), (runs = []) =>
        runs.map((run) => ({
          ...run,
          results: run.results.map((r) =>
            r.id === saved.id
              ? saved
              : r.patientId === saved.patientId && r.trialId === saved.trialId
                ? { ...r, decision, note, decidedAt }
                : r,
          ),
        })),
      );
      const other: MatchSubject | null =
        subject.kind === 'patient'
          ? { kind: 'trial', id: saved.trialId }
          : saved.patientId === null
            ? null
            : { kind: 'patient', id: saved.patientId };
      if (other) void qc.invalidateQueries({ queryKey: matchKeys.runs(other) });
      // Week 9: open History panels show the new event.
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** The referral summary PDF of the shortlisted trials, saved through the browser. */
export function useDownloadReferral(patientId: number) {
  return useMutation({
    mutationFn: () => download(`/patients/${patientId}/referral.pdf`),
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
export function useFollowRun(subject: MatchSubject, run?: MatchRun) {
  const qc = useQueryClient();
  const { kind, id } = subject;
  const runId = run?.id;
  const active = isActive(run);

  useEffect(() => {
    if (!runId || !active) return;
    const controller = new AbortController();
    const update = (next: MatchRun) =>
      qc.setQueryData<MatchRun[]>(matchKeys.runs({ kind, id }), (runs = []) =>
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
  }, [runId, active, kind, id, qc]);
}
