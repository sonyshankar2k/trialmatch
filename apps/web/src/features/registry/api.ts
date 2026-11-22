import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  PendingTrialUpdate,
  RegistryPreview,
  RegistrySearchQuery,
  RegistrySearchResult,
  RegistrySyncResult,
  Trial,
} from '@trialmatch/shared';
import { api } from '../../lib/api';
import { trialKeys } from '../trials/api';

export const registryKeys = {
  search: (q: Omit<RegistrySearchQuery, 'pageToken'>) =>
    ['registry', 'search', q] as const,
  preview: (nctId: string) => ['registry', 'preview', nctId] as const,
  update: (trialId: number) => ['registry', 'update', trialId] as const,
};

/** Search ClinicalTrials.gov. "Load more" fetches the next page with the registry's page token. */
export function useRegistrySearch(
  query: Omit<RegistrySearchQuery, 'pageToken'> | null,
) {
  return useInfiniteQuery({
    queryKey: registryKeys.search(query ?? {}),
    queryFn: ({ pageParam }) =>
      api<RegistrySearchResult>('/registry/studies', {
        query: { ...query, pageToken: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: query !== null,
    staleTime: 5 * 60_000, // the registry changes slowly; don't re-ask on every focus
  });
}

export function useRegistryPreview(nctId: string | null) {
  return useQuery({
    queryKey: registryKeys.preview(nctId ?? ''),
    queryFn: () => api<RegistryPreview>(`/registry/studies/${nctId}`),
    enabled: nctId !== null,
    staleTime: 5 * 60_000,
  });
}

export function useImportStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nctId: string) =>
      api<Trial>('/registry/imports', { method: 'POST', body: { nctId } }),
    onSuccess: (trial) => {
      qc.setQueryData(trialKeys.detail(trial.id), trial);
      qc.invalidateQueries({ queryKey: ['trials', 'list'] });
      // Search results and previews now point at the new trial.
      qc.invalidateQueries({ queryKey: ['registry'] });
    },
  });
}

// ------------------------------------------------- Week 8: keeping imports in sync

/** The trial's pending registry update (`update` is null when it is in step). */
export function useTrialUpdate(trialId: number, enabled: boolean) {
  return useQuery({
    queryKey: registryKeys.update(trialId),
    queryFn: () =>
      api<PendingTrialUpdate>(`/registry/trials/${trialId}/update`),
    enabled,
  });
}

/** Check this trial against ClinicalTrials.gov now. */
export function useCheckTrial(trialId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<PendingTrialUpdate>(`/registry/trials/${trialId}/check`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      qc.setQueryData(registryKeys.update(trialId), result);
      // "Last checked" and the pending flag live on the trial.
      void qc.invalidateQueries({ queryKey: trialKeys.detail(trialId) });
      void qc.invalidateQueries({ queryKey: ['trials', 'list'] });
    },
  });
}

/**
 * Apply the update or keep the trial as it is. Both send the update revision
 * reviewed (409 if the registry changed again); Apply also the trial version read.
 */
export function useResolveUpdate(trialId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      action:
        | {
            kind: 'apply';
            id: number;
            revision: number;
            version: number;
            reconciled: boolean;
          }
        | { kind: 'dismiss'; id: number; revision: number },
    ) =>
      action.kind === 'apply'
        ? api<Trial>(`/registry/updates/${action.id}/apply`, {
            method: 'POST',
            body: {
              revision: action.revision,
              version: action.version,
              reconciled: action.reconciled,
            },
          })
        : api<Trial>(`/registry/updates/${action.id}/dismiss`, {
            method: 'POST',
            body: { revision: action.revision },
          }),
    onSuccess: (trial) => {
      qc.setQueryData(trialKeys.detail(trial.id), trial);
      qc.setQueryData<PendingTrialUpdate>(registryKeys.update(trialId), {
        update: null,
      });
      // Week 9: open History panels show the new event.
      void qc.invalidateQueries({ queryKey: ['audit'] });
      void qc.invalidateQueries({ queryKey: ['trials', 'list'] });
    },
    // Someone else resolved it, or the registry changed again: show what is pending now.
    onError: () =>
      void qc.invalidateQueries({ queryKey: registryKeys.update(trialId) }),
  });
}

/** Check every imported trial now. */
export function useSyncRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<RegistrySyncResult>('/registry/sync', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trialKeys.all });
      void qc.invalidateQueries({ queryKey: ['registry', 'update'] });
    },
  });
}
