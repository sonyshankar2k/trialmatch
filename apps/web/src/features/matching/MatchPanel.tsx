import {
  DECISION_LABELS,
  ELIGIBILITY_LABELS,
  verdictLabel,
  type CriterionAssessment,
  type Eligibility,
  type MatchResult,
  type MatchReviewInput,
} from '@trialmatch/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../lib/api';
import {
  isActive,
  useDownloadReferral,
  useFollowRun,
  useMatchRuns,
  useReviewMatch,
  useStartMatch,
} from './api';

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
/** "Find matching trials" for one patient: start a run, watch it live, review the results. */
export function MatchPanel({ patientId }: { patientId: number }) {
  const runs = useMatchRuns(patientId);
  const start = useStartMatch(patientId);
  const latest = runs.data?.[0];
  useFollowRun(patientId, latest);
  const active = isActive(latest);
  const review = useReviewMatch(patientId);
  const referral = useDownloadReferral(patientId);
  const shortlisted =
    latest?.results.filter((r) => r.decision === 'shortlisted').length ?? 0;

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
            <span className="ml-2 text-xs text-slate-500">
              {latest.engine === 'claude'
                ? 'Assessed by Claude'
                : 'Rule-based estimate (no AI key configured)'}{' '}
              ·{' '}
              {new Date(latest.finishedAt ?? latest.createdAt).toLocaleString()}
            </span>
          </p>
          {latest.results.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-slate-50 px-3 py-2">
              <p className="flex-1 text-sm text-slate-600">
                {shortlisted === 0
                  ? 'Shortlist the trials to refer this patient to.'
                  : `${shortlisted} ${shortlisted === 1 ? 'trial' : 'trials'} shortlisted for referral.`}
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={shortlisted === 0 || referral.isPending}
                onClick={() => referral.mutate()}
              >
                {referral.isPending
                  ? 'Preparing PDF…'
                  : 'Download referral summary (PDF)'}
              </button>
            </div>
          )}
          {(review.isError || referral.isError) && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {errorMessage(review.error ?? referral.error)}
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {latest.results.map((r) => (
              <MatchCard
                key={r.id}
                result={r}
                saving={review.isPending && review.variables?.id === r.id}
                onReview={(input) => review.mutateAsync({ id: r.id, ...input })}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One assessed trial: the decision, the summary, and a table of criterion verdicts. */
export function MatchCard({
  result,
  onReview,
  saving = false,
}: {
  result: MatchResult;
  /** Week 6: without it the card is read-only. Resolves once the review is saved. */
  onReview?: (review: MatchReviewInput) => Promise<unknown>;
  saving?: boolean;
}) {
  const dismissed = result.decision === 'dismissed';
  const [open, setOpen] = useState(
    result.eligibility !== 'not_eligible' && !dismissed,
  );
  const detailsId = `match-${result.id}-criteria`;
  return (
    <li
      className={`rounded-md border ${
        result.decision === 'shortlisted'
          ? 'border-brand-600 ring-1 ring-brand-600'
          : 'border-slate-200'
      } ${dismissed ? 'bg-slate-50' : ''}`}
      aria-label={`${result.title}: ${DECISION_LABELS[result.decision]}`}
    >
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
      {onReview ? (
        <ReviewControls result={result} onReview={onReview} saving={saving} />
      ) : (
        result.note && <NoteText note={result.note} />
      )}
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

const NoteText = ({ note }: { note: string }) => (
  <p className="border-t border-slate-100 px-4 py-2 text-sm whitespace-pre-line text-slate-700">
    <span className="font-medium">Note: </span>
    {note}
  </p>
);

/**
 * Shortlist / Dismiss toggles (pressing the active one again clears it) and a
 * note for the study team. The note is kept when the decision changes.
 */
function ReviewControls({
  result,
  onReview,
  saving,
}: {
  result: MatchResult;
  onReview: (review: MatchReviewInput) => Promise<unknown>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(result.note ?? '');
  const noteId = useId();
  const toggle = (decision: 'shortlisted' | 'dismissed') =>
    onReview({
      decision: result.decision === decision ? 'pending' : decision,
      note: result.note,
    }).catch(() => undefined); // the panel shows the error
  const saveNote = () =>
    onReview({ decision: result.decision, note: draft }).then(
      () => setEditing(false),
      () => undefined,
    );
  const pressed = (on: boolean) =>
    on ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700' : '';

  return (
    <div className="border-t border-slate-100">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <button
          type="button"
          className={`btn-secondary px-2.5 py-1 text-xs ${pressed(result.decision === 'shortlisted')}`}
          aria-pressed={result.decision === 'shortlisted'}
          disabled={saving}
          onClick={() => toggle('shortlisted')}
        >
          Shortlist
        </button>
        <button
          type="button"
          className={`btn-secondary px-2.5 py-1 text-xs ${pressed(result.decision === 'dismissed')}`}
          aria-pressed={result.decision === 'dismissed'}
          disabled={saving}
          onClick={() => toggle('dismissed')}
        >
          Dismiss
        </button>
        {!editing && (
          <button
            type="button"
            className="text-xs text-brand-700 hover:underline"
            onClick={() => {
              setDraft(result.note ?? '');
              setEditing(true);
            }}
          >
            {result.note ? 'Edit note' : 'Add note'}
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {DECISION_LABELS[result.decision]}
          {result.decidedAt &&
            ` · ${new Date(result.decidedAt).toLocaleDateString()}`}
        </span>
      </div>
      {editing ? (
        <form
          className="px-4 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <label htmlFor={noteId} className="label">
            Note for the study team
          </label>
          <textarea
            id={noteId}
            className="input"
            rows={3}
            maxLength={1000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              className="btn-primary px-2.5 py-1 text-xs"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        result.note && <NoteText note={result.note} />
      )}
    </div>
  );
}
