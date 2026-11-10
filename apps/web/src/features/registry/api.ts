import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  RegistryPreview,
  RegistrySearchQuery,
  RegistrySearchResult,
  Trial,
} from '@trialmatch/shared';
import { api } from '../../lib/api';
import { trialKeys } from '../trials/api';

export const registryKeys = {
  search: (q: Omit<RegistrySearchQuery, 'pageToken'>) =>
    ['registry', 'search', q] as const,
  preview: (nctId: string) => ['registry', 'preview', nctId] as const,
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
