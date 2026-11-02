import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Page,
  Patient,
  PatientCreateInput,
  PatientUpdateInput,
} from '@trialmatch/shared';
import { api } from '../../lib/api';

export const patientKeys = {
  list: (q: object) => ['patients', 'list', q] as const,
  detail: (id: number) => ['patients', 'detail', id] as const,
};

export const patientQuery = (id: number) =>
  queryOptions({
    queryKey: patientKeys.detail(id),
    queryFn: () => api<Patient>(`/patients/${id}`),
  });

export function usePatients(query: {
  search?: string;
  page: number;
  pageSize: number;
}) {
  return useQuery({
    queryKey: patientKeys.list(query),
    queryFn: () => api<Page<Patient>>('/patients', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useSavePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id?: number;
      body: PatientCreateInput | PatientUpdateInput;
    }) =>
      args.id
        ? api<Patient>(`/patients/${args.id}`, {
            method: 'PATCH',
            body: args.body,
          })
        : api<Patient>('/patients', { method: 'POST', body: args.body }),
    onSuccess: (p) => {
      qc.setQueryData(patientKeys.detail(p.id), p);
      qc.invalidateQueries({ queryKey: ['patients', 'list'] });
    },
  });
}

export function useDeletePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: number; version: number }) =>
      api<void>(`/patients/${p.id}`, {
        method: 'DELETE',
        query: { version: p.version },
      }),
    onSuccess: (_, p) => {
      qc.removeQueries({ queryKey: patientKeys.detail(p.id) });
      qc.invalidateQueries({ queryKey: ['patients', 'list'] });
    },
  });
}
