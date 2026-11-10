import { registryUrl, type RegistryPreview } from '@trialmatch/shared';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDate } from '../../lib/dates';

export const ageRange = (min: number | null, max: number | null) =>
  min == null && max == null
    ? 'Any age'
    : max == null
      ? `${min}+ years`
      : `${min ?? 0}–${max} years`;

const SEX_LABELS = { all: 'All', female: 'Female only', male: 'Male only' };

/**
 * A ClinicalTrials.gov study as it will be imported: the mapped fields, the
 * eligibility text split into numbered criteria, and anything the import had to
 * interpret, so the person can check it before matching patients against it.
 */
export function StudyPreview({
  preview,
  onImport,
  importing = false,
  error,
}: {
  preview: RegistryPreview;
  onImport: () => void;
  importing?: boolean;
  error?: string | null;
}) {
  const { trial } = preview;
  const inclusion = trial.criteria.filter((c) => c.type === 'inclusion');
  const exclusion = trial.criteria.filter((c) => c.type === 'exclusion');

  return (
    <article className="card p-5" aria-labelledby="preview-title">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <a
          href={registryUrl(preview.nctId)}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-700 underline"
        >
          {preview.nctId} on ClinicalTrials.gov
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {preview.lastUpdated && (
          <span>· Updated {formatDate(preview.lastUpdated)}</span>
        )}
      </div>
      <h2 id="preview-title" className="mt-1 text-lg font-semibold">
        {trial.title}
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Fact label="Condition" wide>
          {trial.condition}
        </Fact>
        <Fact label="Status">
          <StatusBadge status={trial.status} />
        </Fact>
        <Fact label="Phase">{trial.phase}</Fact>
        <Fact label="Ages">{ageRange(trial.minAge, trial.maxAge)}</Fact>
        <Fact label="Sex">{SEX_LABELS[trial.sex]}</Fact>
        {trial.sponsor && (
          <Fact label="Sponsor" wide>
            {trial.sponsor}
          </Fact>
        )}
      </dl>

      {preview.warnings.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <h3 className="font-medium">Check after importing</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <CriteriaList title="Inclusion criteria" prefix="I" items={inclusion} />
      <CriteriaList title="Exclusion criteria" prefix="E" items={exclusion} />

      {preview.sourceCriteriaText && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
            Eligibility text as written on ClinicalTrials.gov
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-50 p-3 font-sans text-xs whitespace-pre-wrap text-slate-700">
            {preview.sourceCriteriaText}
          </pre>
        </details>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        {preview.importedTrialId ? (
          <>
            <Link
              to={`/trials/${preview.importedTrialId}`}
              className="btn-primary"
            >
              Open trial
            </Link>
            <span className="text-sm text-slate-600">
              Already in TrialMatch.
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary"
              onClick={onImport}
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Import trial'}
            </button>
            <span className="text-sm text-slate-600">
              You can edit everything after importing.
            </span>
          </>
        )}
        {error && (
          <p role="alert" className="w-full text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

function Fact({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : undefined}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

function CriteriaList({
  title,
  prefix,
  items,
}: {
  title: string;
  prefix: string;
  items: { text: string }[];
}) {
  return (
    <section className="mt-4">
      <h3 className="text-sm font-medium text-slate-700">
        {title} <span className="text-slate-500">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">None listed.</p>
      ) : (
        <ol className="mt-1 space-y-1 text-sm">
          {items.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-8 shrink-0 font-mono text-xs leading-5 text-slate-500">
                {prefix}
                {i + 1}
              </span>
              <span>{c.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
