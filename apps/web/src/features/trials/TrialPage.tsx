import { useQuery, useQueryClient } from '@tanstack/react-query';
import { registryUrl, type Trial } from '@trialmatch/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConflictBanner } from '../../components/ConflictBanner';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { changedFields } from '../../lib/diff';
import { applyServerErrors } from '../../lib/forms';
import { trialKeys, trialQuery, useDeleteTrial, useSaveTrial } from './api';
import {
  toFormValues,
  TrialFormFields,
  useTrialForm,
  type TrialFormValues,
} from './TrialForm';

export function TrialPage() {
  const { id } = useParams();
  if (id === 'new') return <TrialEditor />;
  return <ExistingTrial id={Number(id)} />;
}

function ExistingTrial({ id }: { id: number }) {
  const { data, isPending, error } = useQuery({
    ...trialQuery(id),
    enabled: Number.isInteger(id) && id > 0,
  });
  if (
    !Number.isInteger(id) ||
    id < 1 ||
    (error instanceof ApiRequestError && error.status === 404)
  ) {
    return <NotFound />;
  }
  if (isPending)
    return <p className="text-sm text-slate-500">Loading trial…</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700">
        {errorMessage(error)}
      </p>
    );
  return <TrialEditor key={data.id} trial={data} />;
}

function NotFound() {
  return (
    <div className="card p-6">
      <h1 className="text-lg font-semibold">Trial not found</h1>
      <p className="mt-1 text-sm text-slate-600">It may have been deleted.</p>
      <Link to="/trials" className="btn-secondary mt-4">
        Back to trials
      </Link>
    </div>
  );
}

/** One editor for new and existing trials. Existing ones save only the fields you changed. */
function TrialEditor({ trial }: { trial?: Trial }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useTrialForm(trial);
  const save = useSaveTrial();
  const remove = useDeleteTrial();
  const [base, setBase] = useState<Trial | undefined>(trial); // what the form started from
  const [conflict, setConflict] = useState<Trial | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = async (values: TrialFormValues, version?: number) => {
    setMessage(null);
    try {
      if (!base) {
        const created = await save.mutateAsync({ body: values });
        navigate(`/trials/${created.id}`, { replace: true });
        return;
      }
      const changes = changedFields(toFormValues(base), values);
      if (Object.keys(changes).length === 0 && version === undefined) {
        setMessage('No changes to save.');
        return;
      }
      const saved = await save.mutateAsync({
        id: base.id,
        body: { ...changes, version: version ?? base.version },
      });
      setBase(saved);
      setConflict(null);
      form.reset(toFormValues(saved));
      setMessage('Saved.');
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.body.current
      ) {
        setConflict(err.body.current as Trial);
      } else if (!applyServerErrors(err, form.setError)) {
        setMessage(errorMessage(err));
      }
    }
  };

  const loadTheirs = () => {
    if (!conflict) return;
    qc.setQueryData(trialKeys.detail(conflict.id), conflict);
    setBase(conflict);
    form.reset(toFormValues(conflict));
    setConflict(null);
  };

  const onDelete = async () => {
    if (!base) return;
    try {
      await remove.mutateAsync({ id: base.id, version: base.version });
      navigate('/trials', { replace: true });
    } catch (err) {
      setConfirmDelete(false);
      if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.body.current
      )
        setConflict(err.body.current as Trial);
      else setMessage(errorMessage(err));
    }
  };

  return (
    <form onSubmit={form.handleSubmit((v) => submit(v))} noValidate>
      <Link
        to="/trials"
        className="text-sm text-slate-500 hover:text-slate-800"
      >
        ← Trials
      </Link>
      <div className="mt-1 mb-4 flex flex-wrap items-start gap-3">
        <h1 className="min-w-0 flex-1 basis-80 text-2xl font-semibold">
          {base ? base.title : 'New trial'}
        </h1>
        {base && !confirmDelete && (
          <button
            type="button"
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
        {base && confirmDelete && (
          <>
            <span className="text-sm text-slate-600">Delete this trial?</span>
            <button
              type="button"
              className="btn-danger"
              onClick={onDelete}
              disabled={remove.isPending}
            >
              Yes, delete
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </>
        )}
        <button
          type="submit"
          className="btn-primary"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting
            ? 'Saving…'
            : base
              ? 'Save changes'
              : 'Create trial'}
        </button>
      </div>

      {conflict && (
        <ConflictBanner
          onReload={loadTheirs}
          onOverwrite={form.handleSubmit((v) => submit(v, conflict.version))}
        />
      )}
      {message && (
        <p role="status" className="mb-4 text-sm text-slate-600">
          {message}
        </p>
      )}
      {base && (
        <p className="mb-4 text-xs text-slate-500">
          {base.source === 'clinicaltrials_gov' ? 'Imported' : 'Created'} by{' '}
          {base.createdBy} · Last saved{' '}
          {new Date(base.updatedAt).toLocaleString()} · Version {base.version}
        </p>
      )}
      {base?.source === 'clinicaltrials_gov' && base.nctId && (
        <p className="mb-4 rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-slate-700">
          Imported from ClinicalTrials.gov
          {base.sourceLastUpdated &&
            ` (record last updated ${formatDate(base.sourceLastUpdated)})`}
          .{' '}
          <a
            href={registryUrl(base.nctId)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-700 underline"
          >
            View {base.nctId} on ClinicalTrials.gov
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      )}
      <TrialFormFields form={form} />
    </form>
  );
}
