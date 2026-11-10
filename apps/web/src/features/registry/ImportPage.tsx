import {
  REGISTRY_SEARCH_STATUSES,
  type RegistrySearchQuery,
} from '@trialmatch/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useImportStudy, useRegistryPreview, useRegistrySearch } from './api';
import { ageRange, StudyPreview } from './StudyPreview';

type SearchStatus = (typeof REGISTRY_SEARCH_STATUSES)[number];
const STATUS_OPTIONS: Record<SearchStatus, string> = {
  recruiting: 'Recruiting',
  not_yet_recruiting: 'Not yet recruiting',
  any: 'Any status',
};
const NCT_ID = /^\s*(NCT\d{8})\s*$/i;

/**
 * Find studies on ClinicalTrials.gov and import them as trials. The search and
 * the selected study live in the URL, so the page survives refresh and can be shared.
 */
export function ImportPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const condition = params.get('condition') ?? '';
  const term = params.get('term') ?? '';
  const status = (params.get('status') ?? 'recruiting') as SearchStatus;
  const selected = params.get('study');

  const [draft, setDraft] = useState({ condition, term, status });
  const [formError, setFormError] = useState<string | null>(null);

  const query: Omit<RegistrySearchQuery, 'pageToken'> | null =
    condition || term
      ? { condition: condition || undefined, term: term || undefined, status }
      : null;
  const search = useRegistrySearch(query);
  const preview = useRegistryPreview(selected);
  const importStudy = useImportStudy();
  const previewRef = useRef<HTMLDivElement>(null);

  // On narrow screens the preview sits below the results: bring it into view.
  useEffect(() => {
    if (selected && window.innerWidth < 1024) {
      previewRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [selected]);

  const setUrl = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const c = draft.condition.trim();
    const t = draft.term.trim();
    if (!c && !t) {
      setFormError('Enter a condition or other search words.');
      return;
    }
    setFormError(null);
    importStudy.reset();
    // An NCT ID goes straight to that study.
    const nct = (t.match(NCT_ID) ?? c.match(NCT_ID))?.[1];
    if (nct) {
      setUrl({ study: nct.toUpperCase() });
      return;
    }
    setUrl({
      condition: c || null,
      term: t || null,
      status: draft.status === 'recruiting' ? null : draft.status,
      study: null,
    });
  };

  const select = (nctId: string) => {
    importStudy.reset();
    setUrl({ study: nctId });
  };

  const onImport = async () => {
    if (!selected) return;
    try {
      const trial = await importStudy.mutateAsync(selected);
      navigate(`/trials/${trial.id}`);
      window.scrollTo?.(0, 0);
    } catch (err) {
      // Someone imported it a moment ago: open theirs.
      const current =
        err instanceof ApiRequestError && err.status === 409
          ? (err.body.current as { id?: number } | undefined)
          : undefined;
      if (current?.id) navigate(`/trials/${current.id}`);
    }
  };

  const hits = search.data?.pages.flatMap((p) => p.items) ?? [];
  const total = search.data?.pages[0]?.total;

  return (
    <section>
      <Link
        to="/trials"
        className="text-sm text-slate-500 hover:text-slate-800"
      >
        ← Trials
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">
        Import from ClinicalTrials.gov
      </h1>
      <p className="mt-1 mb-4 max-w-2xl text-sm text-slate-600">
        Search the public US registry of clinical studies. Pick a study to see
        how it will look in TrialMatch, including its eligibility criteria, then
        import it to match your patients against it.
      </p>

      <form
        onSubmit={onSearch}
        noValidate
        role="search"
        aria-label="Search ClinicalTrials.gov"
        className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
      >
        <div>
          <label className="label" htmlFor="registry-condition">
            Condition
          </label>
          <input
            id="registry-condition"
            className="input"
            placeholder="e.g. type 2 diabetes"
            value={draft.condition}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'registry-form-error' : undefined}
            onChange={(e) => setDraft({ ...draft, condition: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="registry-term">
            Other words or NCT ID
          </label>
          <input
            id="registry-term"
            className="input"
            placeholder="e.g. semaglutide, NCT04368728"
            value={draft.term}
            onChange={(e) => setDraft({ ...draft, term: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="registry-status">
            Status
          </label>
          <select
            id="registry-status"
            className="input"
            value={draft.status}
            onChange={(e) =>
              setDraft({ ...draft, status: e.target.value as SearchStatus })
            }
          >
            {REGISTRY_SEARCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_OPTIONS[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">
          Search
        </button>
        {formError && (
          <p
            id="registry-form-error"
            role="alert"
            className="text-sm text-red-700 sm:col-span-4"
          >
            {formError}
          </p>
        )}
      </form>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {query && (
          <div
            className="card overflow-hidden"
            aria-busy={search.isFetching}
            aria-label="Search results"
            role="region"
          >
            {search.isPending ? (
              <p className="p-4 text-sm text-slate-500">
                Searching ClinicalTrials.gov…
              </p>
            ) : search.isError ? (
              <p role="alert" className="p-4 text-sm text-red-700">
                {errorMessage(search.error)}
              </p>
            ) : hits.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                No studies found. Try fewer words or another status.
              </p>
            ) : (
              <>
                <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                  {total != null
                    ? `${total.toLocaleString()} ${total === 1 ? 'study' : 'studies'} found`
                    : 'Studies found'}
                  {total != null && total > hits.length
                    ? ` · showing ${hits.length}`
                    : ''}
                </p>
                <ul className="divide-y divide-slate-100">
                  {hits.map((h) => (
                    <li key={h.nctId}>
                      <button
                        type="button"
                        onClick={() => select(h.nctId)}
                        aria-current={h.nctId === selected ? 'true' : undefined}
                        className="block w-full px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 aria-[current=true]:bg-brand-50"
                      >
                        <span className="block font-medium text-slate-900">
                          {h.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                          <span className="font-mono">{h.nctId}</span>
                          <StatusBadge status={h.status} />
                          <span>{h.phase}</span>
                          <span>{ageRange(h.minAge, h.maxAge)}</span>
                          {h.importedTrialId && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                              Imported
                            </span>
                          )}
                        </span>
                        {h.conditions.length > 0 && (
                          <span className="mt-1 block truncate text-xs text-slate-600">
                            {h.conditions.join(', ')}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {search.hasNextPage && (
                  <div className="border-t border-slate-100 p-3 text-center">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => search.fetchNextPage()}
                      disabled={search.isFetchingNextPage}
                    >
                      {search.isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div
          ref={previewRef}
          className={`scroll-mt-4 ${query ? '' : 'lg:col-span-2'}`}
        >
          {selected ? (
            preview.isPending ? (
              <p className="card p-5 text-sm text-slate-500">
                Loading {selected} from ClinicalTrials.gov…
              </p>
            ) : preview.isError ? (
              <p role="alert" className="card p-5 text-sm text-red-700">
                {errorMessage(preview.error)}
              </p>
            ) : (
              <StudyPreview
                preview={preview.data}
                onImport={onImport}
                importing={importStudy.isPending}
                error={
                  importStudy.isError ? errorMessage(importStudy.error) : null
                }
              />
            )
          ) : (
            query &&
            hits.length > 0 && (
              <p className="card p-5 text-sm text-slate-500">
                Select a study to preview it.
              </p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
