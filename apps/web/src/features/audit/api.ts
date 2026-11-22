import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditEvent, AuditQuery, Page } from '@trialmatch/shared';
import { api, download } from '../../lib/api';

/** Week 9: whose history a panel shows. */
export type HistorySubject = { kind: 'patient' | 'trial'; id: number };

export const auditKeys = {
  history: (s: HistorySubject) => ['audit', 'history', s.kind, s.id] as const,
  log: (q: AuditQuery) => ['audit', 'log', q] as const,
};

/** A record's history, newest first. Loaded only when someone opens it. */
export function useHistory(subject: HistorySubject, enabled: boolean) {
  return useQuery({
    queryKey: auditKeys.history(subject),
    queryFn: () => api<AuditEvent[]>(`/${subject.kind}s/${subject.id}/history`),
    enabled,
  });
}

/** The administrators' audit log. */
export function useAuditLog(query: AuditQuery) {
  return useQuery({
    queryKey: auditKeys.log(query),
    queryFn: () => api<Page<AuditEvent>>('/audit', { query: { ...query } }),
    placeholderData: keepPreviousData,
  });
}

/** Downloads the filtered log as CSV (the server records the export). */
export function exportAuditCsv(query: AuditQuery): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== '' && k !== 'page' && k !== 'pageSize')
      params.set(k, String(v));
  const qs = params.toString();
  return download(`/audit/export.csv${qs ? `?${qs}` : ''}`);
}
