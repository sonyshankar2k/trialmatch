import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Page,
  Trial,
  TrialCreateInput,
  TrialListQuery,
  TrialSummary,
  TrialUpdateInput,
} from '@trialmatch/shared';
import { api } from '../../lib/api';

export const trialKeys = {
  all: ['trials'] as const,
  list: (q: TrialListQuery) => ['trials', 'list', q] as const,
  detail: (id: number) => ['trials', 'detail', id] as const,
};

export const trialQuery = (id: number) =>
  queryOptions({
    queryKey: trialKeys.detail(id),
    queryFn: () => api<Trial>(`/trials/${id}`),
  });

export function useTrials(query: TrialListQuery) {
  return useQuery({
    queryKey: trialKeys.list(query),
    queryFn: () => api<Page<TrialSummary>>('/trials', { query: { ...query } }),
    placeholderData: keepPreviousData, // keep the old page on screen while the next one loads
  });
}

export function useSaveTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id?: number;
      body: TrialCreateInput | TrialUpdateInput;
    }) =>
      args.id
        ? api<Trial>(`/trials/${args.id}`, { method: 'PATCH', body: args.body })
        : api<Trial>('/trials', { method: 'POST', body: args.body }),
    onSuccess: (trial) => {
      qc.setQueryData(trialKeys.detail(trial.id), trial);
      qc.invalidateQueries({ queryKey: ['trials', 'list'] });
    },
  });
}

export function useDeleteTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: { id: number; version: number }) =>
      api<void>(`/trials/${t.id}`, {
        method: 'DELETE',
        query: { version: t.version },
      }),
    onSuccess: (_, t) => {
      qc.removeQueries({ queryKey: trialKeys.detail(t.id) });
      qc.invalidateQueries({ queryKey: ['trials', 'list'] });
    },
  });
}
