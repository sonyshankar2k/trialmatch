import {
  STATUS_LABELS,
  SYNCED_FIELD_LABELS,
  registryUrl,
  type FieldChange,
  type Trial,
  type TrialStatus,
  type TrialUpdate,
} from '@trialmatch/shared';
import { useState } from 'react';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { useCheckTrial, useResolveUpdate, useTrialUpdate } from './api';

/**
 * Week 8: on an imported trial, when ClinicalTrials.gov was last asked, a
 * "Check now" button, and any pending update with Apply / Keep.
 */
export function RegistrySync({
  trial,
  checkedAt,
  unsavedChanges,
  onTrialChanged,
}: {
  /** The trial the form started from: its version goes with Apply. */
  trial: Trial;
  /** When ClinicalTrials.gov was last asked, from the latest copy of the trial. */
  checkedAt: string | null;
  /** Applying replaces the form's values, so it waits until edits are saved or discarded. */
  unsavedChanges: boolean;
  /**
   * The trial after a decision. `applied` and `reloaded` (a newer version on
   * 409) replace the form; `kept` changes only registry details, so a draft stays.
   */
  onTrialChanged: (
    trial: Trial,
    message: string,
    kind: 'applied' | 'kept' | 'reloaded',
  ) => void;
}) {
  const pending = useTrialUpdate(trial.id, true);
  const check = useCheckTrial(trial.id);
  const resolve = useResolveUpdate(trial.id);
  const [checked, setChecked] = useState<string | null>(null);
  const update = pending.data?.update ?? null;

  const onCheck = () =>
    check.mutate(undefined, {
      onSuccess: (r) =>
        setChecked(
          r.update
            ? null
            : 'In step with ClinicalTrials.gov: no changes to review.',
        ),
    });

  const onResolve = (kind: 'apply' | 'dismiss') => {
    if (!update) return;
    resolve.mutate(
      kind === 'apply'
        ? {
            kind,
            id: update.id,
            revision: update.revision,
            version: trial.version,
          }
        : { kind, id: update.id, revision: update.revision },
      {
        onSuccess: (saved) =>
          kind === 'apply'
            ? onTrialChanged(
                saved,
                'Update applied. Screen your patients again so matches use the new version.',
                'applied',
              )
            : onTrialChanged(
                saved,
                'Kept the current version. This registry change won’t be raised again.',
                'kept',
              ),
        onError: (err) => {
          // The trial was saved by someone else meanwhile: load it and review again.
          if (
            err instanceof ApiRequestError &&
            err.status === 409 &&
            err.body.current
          )
            onTrialChanged(
              err.body.current as Trial,
              'The trial was changed meanwhile. Its latest version is loaded; review the update again.',
              'reloaded',
            );
        },
      },
    );
  };

  return (
    <section
      className="mb-4 rounded-md border border-slate-200 p-3"
      aria-labelledby="registry-sync-heading"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="registry-sync-heading" className="flex-1 text-sm font-medium">
          ClinicalTrials.gov updates
          <span className="ml-2 font-normal text-slate-500">
            {checkedAt
              ? `Last checked ${new Date(checkedAt).toLocaleString()}`
              : 'Not checked yet'}
          </span>
        </h2>
        <button
          type="button"
          className="btn-secondary px-2.5 py-1 text-xs"
          disabled={check.isPending}
          onClick={onCheck}
        >
          {check.isPending ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {checked && !update && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {checked}
        </p>
      )}
      {(check.isError || resolve.isError || pending.isError) && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {errorMessage(check.error ?? resolve.error ?? pending.error)}
        </p>
      )}
      {update && (
        <UpdateDetails
          update={update}
          busy={resolve.isPending}
          unsavedChanges={unsavedChanges}
          onApply={() => onResolve('apply')}
          onKeep={() => onResolve('dismiss')}
        />
      )}
    </section>
  );
}

/** What the registry changed, next to what TrialMatch has, with the two choices. */
export function UpdateDetails({
  update,
  busy = false,
  unsavedChanges = false,
  onApply,
  onKeep,
}: {
  update: TrialUpdate;
  busy?: boolean;
  unsavedChanges?: boolean;
  onApply: () => void;
  onKeep: () => void;
}) {
  const { added, removed } = update.criteria;
  const hintId = `update-${update.id}-hint`;
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">
        ClinicalTrials.gov changed this study
        {update.registryLastUpdated &&
          ` (record updated ${formatDate(update.registryLastUpdated)})`}
        .{' '}
        <a
          href={registryUrl(update.nctId)}
          target="_blank"
          rel="noreferrer"
          className="font-normal text-brand-700 underline"
        >
          View {update.nctId}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
      {update.fields.length > 0 && (
        <table className="mt-2 w-full bg-white text-left text-sm">
          <caption className="sr-only">Changed fields</caption>
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Field</th>
              <th className="px-3 py-1.5 font-medium">In TrialMatch</th>
              <th className="px-3 py-1.5 font-medium">On ClinicalTrials.gov</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {update.fields.map((f) => (
              <tr key={f.field} className="align-top">
                <th scope="row" className="px-3 py-1.5 font-medium">
                  {SYNCED_FIELD_LABELS[f.field]}
                </th>
                <td className="px-3 py-1.5 text-slate-600">
                  {show(f, f.current)}
                </td>
                <td className="px-3 py-1.5">{show(f, f.registry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(added.length > 0 || removed.length > 0) && (
        <div className="mt-2 text-sm">
          <p className="font-medium">Eligibility criteria</p>
          <ul className="mt-1 space-y-1">
            {added.map((c) => (
              <li key={`+${c.type}${c.text}`} className="text-green-800">
                <span className="font-medium">Added {c.type}:</span> {c.text}
              </li>
            ))}
            {removed.map((c) => (
              <li key={`-${c.type}${c.text}`} className="text-red-800">
                <span className="font-medium">Removed {c.type}:</span>{' '}
                <s>{c.text}</s>
              </li>
            ))}
          </ul>
        </div>
      )}
      {update.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
          {update.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary px-2.5 py-1 text-xs"
          disabled={busy || unsavedChanges}
          aria-describedby={unsavedChanges ? hintId : undefined}
          onClick={onApply}
        >
          Apply update
        </button>
        <button
          type="button"
          className="btn-secondary px-2.5 py-1 text-xs"
          disabled={busy}
          onClick={onKeep}
        >
          Keep current version
        </button>
        {unsavedChanges && (
          <span id={hintId} className="text-xs text-slate-600">
            Save or discard your edits before applying.
          </span>
        )}
      </div>
    </div>
  );
}

function show(f: FieldChange, v: string | number | null) {
  if (v === null || v === '')
    return <span className="text-slate-400">None</span>;
  if (f.field === 'status') return STATUS_LABELS[v as TrialStatus] ?? v;
  if (f.field === 'minAge' || f.field === 'maxAge') return `${v} years`;
  return String(v);
}
