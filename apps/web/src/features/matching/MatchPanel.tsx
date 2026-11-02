import {
  ELIGIBILITY_LABELS,
  type CriterionAssessment,
  type Eligibility,
  type TrialMatch,
} from '@trialmatch/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../lib/api';
import { isActive, useFollowRun, useMatchRuns, useStartMatch } from './api';

const eligibilityStyle: Record<Eligibility, string> = {
  eligible: 'bg-green-50 text-green-700 ring-green-600/20',
  possibly_eligible: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  not_eligible: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};
/** Green when the answer favours eligibility, red when it rules the patient out. */
const verdictStyle = (a: CriterionAssessment) =>
  a.verdict === 'unknown'
    ? 'text-amber-700'
    : (a.type === 'inclusion') === (a.verdict === 'met')
      ? 'text-green-700'
      : 'text-red-700';
const verdictLabel = (a: CriterionAssessment) =>
  a.verdict === 'unknown'
    ? 'Unknown'
    : a.type === 'exclusion'
      ? a.verdict === 'met'
        ? 'Applies'
        : 'Does not apply'
      : a.verdict === 'met'
        ? 'Met'
        : 'Not met';

/** "Find matching trials" for one patient: start a run, watch it live, review the results. */
export function MatchPanel({ patientId }: { patientId: number }) {
  const runs = useMatchRuns(patientId);
  const start = useStartMatch(patientId);
  const latest = runs.data?.[0];
  useFollowRun(patientId, latest);
  const active = isActive(latest);

  return (
    <section className="card mt-6 p-5" aria-labelledby="matches-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="matches-heading" className="text-base font-semibold">
            Trial matches
          </h2>
          <p className="text-sm text-slate-500">
            Decision support only: a person confirms eligibility with the study
            team.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={active || start.isPending}
          onClick={() => start.mutate()}
        >
          {active
            ? 'Matching…'
            : latest
              ? 'Match again'
              : 'Find matching trials'}
        </button>
      </div>

      {start.isError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage(start.error)}
        </p>
      )}
      {runs.isError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage(runs.error)}
        </p>
      )}

      {latest && active && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-600 transition-all"
              style={{ width: `${Math.max(latest.progress, 3)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-600">{latest.stage}</p>
        </div>
      )}

      {latest?.status === 'failed' && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {latest.error ?? 'Matching failed.'}
        </p>
      )}

      {latest?.status === 'succeeded' && (
        <div className="mt-4">
          <p className="text-sm text-slate-600" role="status">
            {latest.stage}
            <span className="ml-2 text-xs text-slate-400">
              {latest.engine === 'claude'
                ? 'Assessed by Claude'
                : 'Rule-based estimate (no AI key configured)'}{' '}
              ·{' '}
              {new Date(latest.finishedAt ?? latest.createdAt).toLocaleString()}
            </span>
          </p>
          <ul className="mt-3 space-y-3">
            {latest.results.map((r) => (
              <MatchCard key={r.trialId} result={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MatchCard({ result }: { result: TrialMatch }) {
  const [open, setOpen] = useState(result.eligibility !== 'not_eligible');
  const detailsId = `match-${result.trialId}-criteria`;
  return (
    <li className="rounded-md border border-slate-200">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <Link
            to={`/trials/${result.trialId}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {result.title}
          </Link>
          <p className="text-xs text-slate-500">
            {result.nctId ?? 'No NCT ID'} · {result.condition}
          </p>
          <p className="mt-1 text-sm text-slate-700">{result.summary}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${eligibilityStyle[result.eligibility]}`}
        >
          {ELIGIBILITY_LABELS[result.eligibility]}
        </span>
        <button
          type="button"
          className="text-sm text-brand-700 hover:underline"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen(!open)}
        >
          {open
            ? 'Hide criteria'
            : `Show ${result.assessments.length} criteria`}
        </button>
      </div>
      {open && (
        <table
          id={detailsId}
          className="w-full border-t border-slate-100 text-left text-sm"
        >
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Criterion</th>
              <th className="px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.assessments.map((a) => (
              <tr key={a.criterionId} className="align-top">
                <td className="px-4 py-2">
                  <span className="mr-1.5 font-mono text-xs text-slate-500">
                    {a.code}
                  </span>
                  {a.text}
                </td>
                <td
                  className={`px-4 py-2 font-medium whitespace-nowrap ${verdictStyle(a)}`}
                >
                  {verdictLabel(a)}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {a.reason}
                  {a.evidence && (
                    <q className="mt-1 block text-xs text-slate-500">
                      {a.evidence}
                    </q>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
