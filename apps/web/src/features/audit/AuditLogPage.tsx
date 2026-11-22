import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_TYPES,
  type AuditAction,
  type AuditEntityType,
  type AuditEvent,
  type AuditQuery,
} from '@trialmatch/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Pagination } from '../../components/Pagination';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced } from '../../lib/useDebounced';
import { exportAuditCsv, useAuditLog } from './api';
import { actionLabel, actorName, describeChange, formatWhen } from './describe';

const PAGE_SIZE = 50;

/** Week 9: every recorded event, for administrators. Filters live in the URL. */
export function AuditLogPage() {
  const { user } = useAuth();
  if (user?.role !== 'admin')
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">
          Only administrators can see the audit log. Each patient and trial page
          shows its own history.
        </p>
      </div>
    );
  return <AuditLog />;
}

function AuditLog() {
  const [params, setParams] = useSearchParams();
  const actor = params.get('actor') ?? '';
  const debouncedActor = useDebounced(actor);
  const query: AuditQuery = {
    action: (params.get('action') || undefined) as AuditAction | undefined,
    entityType: (params.get('entityType') || undefined) as
      AuditEntityType | undefined,
    actor: debouncedActor || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    page: Number(params.get('page')) || 1,
    pageSize: PAGE_SIZE,
  };
  const log = useAuditLog(query);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const onExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await exportAuditCsv({ ...query, actor: actor || undefined });
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="text-sm text-slate-600">
            Every sign-in, change, patient record opened and referral
            downloaded. Entries can’t be edited or deleted.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={exporting}
          onClick={onExport}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
      {exportError && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {exportError}
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input
          className="input"
          type="search"
          aria-label="Person"
          placeholder="Person (name or email)"
          value={actor}
          onChange={(e) => update({ actor: e.target.value })}
        />
        <select
          className="input"
          aria-label="Action"
          value={query.action ?? ''}
          onChange={(e) => update({ action: e.target.value })}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {AUDIT_ACTION_LABELS[a]}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Record type"
          value={query.entityType ?? ''}
          onChange={(e) => update({ entityType: e.target.value })}
        >
          <option value="">All records</option>
          {AUDIT_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {AUDIT_ENTITY_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          From
          <input
            className="input"
            type="date"
            value={query.from ?? ''}
            onChange={(e) => update({ from: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          To
          <input
            className="input"
            type="date"
            value={query.to ?? ''}
            onChange={(e) => update({ to: e.target.value })}
          />
        </label>
      </div>

      <div className="card overflow-x-auto" aria-busy={log.isFetching}>
        {log.isPending ? (
          <p className="p-6 text-sm text-slate-500">Loading the audit log…</p>
        ) : log.isError ? (
          <p role="alert" className="p-6 text-sm text-red-700">
            {errorMessage(log.error)}
          </p>
        ) : log.data.items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Nothing recorded matches these filters.
          </p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Audit events, newest first</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">What</th>
                  <th className="px-4 py-3 font-medium">Record</th>
                  <th className="px-4 py-3 font-medium">Changes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {log.data.items.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      <time dateTime={e.at}>{formatWhen(e.at)}</time>
                    </td>
                    <td className="px-4 py-3">
                      {actorName(e)}
                      {e.ip && (
                        <div className="text-xs text-slate-500">{e.ip}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{actionLabel(e)}</td>
                    <td className="px-4 py-3">
                      <RecordCell event={e} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {e.changes.length > 0 ? (
                        <ul className="space-y-0.5">
                          {e.changes.map((c) => (
                            <li key={c.field}>{describeChange(c)}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={query.page ?? 1}
              pageSize={PAGE_SIZE}
              total={log.data.total}
              onPage={(page) => update({ page })}
            />
          </>
        )}
      </div>
    </section>
  );
}

/** The record an event is about, linked when it can still be opened. */
function RecordCell({ event: e }: { event: AuditEvent }) {
  const type = AUDIT_ENTITY_LABELS[e.entityType] ?? e.entityType;
  const deleted = e.action === 'patient.delete' || e.action === 'trial.delete';
  const href = deleted
    ? null
    : e.entityType === 'trial' && e.entityId
      ? `/trials/${e.entityId}`
      : e.trialId && e.entityType === 'trial_update'
        ? `/trials/${e.trialId}`
        : null;
  return (
    <>
      <div className="text-xs text-slate-500">{type}</div>
      {href ? (
        <Link to={href} className="text-brand-700 hover:underline">
          {e.label ?? `#${e.entityId}`}
        </Link>
      ) : (
        <span>{e.label ?? (e.entityId ? `#${e.entityId}` : '—')}</span>
      )}
    </>
  );
}
