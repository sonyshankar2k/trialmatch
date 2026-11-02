import {
  TRIAL_PHASES,
  TRIAL_STATUSES,
  STATUS_LABELS,
  type TrialPhase,
  type TrialStatus,
} from '@trialmatch/shared';
import { Link, useSearchParams } from 'react-router';
import { Pagination } from '../../components/Pagination';
import { StatusBadge } from '../../components/StatusBadge';
import { errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/useDebounced';
import { useTrials } from './api';

/** Filters live in the URL, so a filtered list can be bookmarked, shared and survives refresh. */
export function TrialsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const phase = (params.get('phase') || undefined) as TrialPhase | undefined;
  const status = (params.get('status') || undefined) as TrialStatus | undefined;
  const page = Number(params.get('page')) || 1;
  const debouncedSearch = useDebounced(search);

  const { data, isPending, isError, error, isFetching } = useTrials({
    search: debouncedSearch || undefined,
    phase,
    status,
    page,
    pageSize: 20,
  });

  const update = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in changes)) next.delete('page'); // new filters start at page 1
    setParams(next, { replace: true });
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clinical trials</h1>
        <Link to="/trials/new" className="btn-primary">
          New trial
        </Link>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          className="input"
          type="search"
          aria-label="Search trials"
          placeholder="Search by title, condition, NCT ID or sponsor"
          value={search}
          onChange={(e) => update({ search: e.target.value })}
        />
        <select
          className="input"
          aria-label="Phase"
          value={phase ?? ''}
          onChange={(e) => update({ phase: e.target.value })}
        >
          <option value="">All phases</option>
          {TRIAL_PHASES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Status"
          value={status ?? ''}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {TRIAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden" aria-busy={isFetching}>
        {isPending ? (
          <p className="p-6 text-sm text-slate-500">Loading trials…</p>
        ) : isError ? (
          <p role="alert" className="p-6 text-sm text-red-700">
            {errorMessage(error)}
          </p>
        ) : data.items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No trials match these filters.
          </p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Trial</th>
                  <th className="px-4 py-3 font-medium">Condition</th>
                  <th className="px-4 py-3 font-medium">Phase</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Criteria</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/trials/${t.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {t.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {t.nctId ?? 'No NCT ID yet'}
                        {t.sponsor && ` · ${t.sponsor}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">{t.condition}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{t.phase}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {t.criteriaCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(p) => update({ page: p })}
            />
          </>
        )}
      </div>
    </section>
  );
}
