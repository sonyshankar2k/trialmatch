import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PatientCreateSchema,
  type Patient,
  type PatientCreateInput,
} from '@trialmatch/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { ConflictBanner } from '../../components/ConflictBanner';
import { Field, fieldProps } from '../../components/Field';
import { TagInput } from '../../components/TagInput';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { changedFields } from '../../lib/diff';
import { applyServerErrors, numberOrNull, textOrNull } from '../../lib/forms';
import {
  patientKeys,
  patientQuery,
  useDeletePatient,
  useSavePatient,
} from './api';

type Values = Required<Pick<PatientCreateInput, 'conditions' | 'medications'>> &
  PatientCreateInput;

const toValues = (p?: Patient): Values => ({
  pseudonym: p?.pseudonym ?? '',
  age: p?.age ?? (undefined as unknown as number),
  sex: p?.sex ?? 'female',
  conditions: p?.conditions ?? [],
  medications: p?.medications ?? [],
  notes: p?.notes ?? null,
});

export function PatientPage() {
  const { id } = useParams();
  if (id === 'new') return <PatientEditor />;
  return <ExistingPatient id={Number(id)} />;
}

function ExistingPatient({ id }: { id: number }) {
  const valid = Number.isInteger(id) && id > 0;
  const { data, isPending, error } = useQuery({
    ...patientQuery(id),
    enabled: valid,
  });
  if (!valid || (error instanceof ApiRequestError && error.status === 404)) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold">Patient not found</h1>
        <Link to="/patients" className="btn-secondary mt-4">
          Back to patients
        </Link>
      </div>
    );
  }
  if (isPending)
    return <p className="text-sm text-slate-500">Loading patient…</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700">
        {errorMessage(error)}
      </p>
    );
  return <PatientEditor key={data.id} patient={data} />;
}

function PatientEditor({ patient }: { patient?: Patient }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const save = useSavePatient();
  const remove = useDeletePatient();
  const [base, setBase] = useState(patient);
  const [conflict, setConflict] = useState<Patient | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(PatientCreateSchema) as never,
    defaultValues: toValues(patient),
    mode: 'onTouched',
  });
  const {
    register,
    control,
    formState: { errors, isSubmitting },
  } = form;

  const submit = async (values: Values, version?: number) => {
    setMessage(null);
    try {
      if (!base) {
        const created = await save.mutateAsync({ body: values });
        navigate(`/patients/${created.id}`, { replace: true });
        return;
      }
      const changes = changedFields(toValues(base), values);
      const saved = await save.mutateAsync({
        id: base.id,
        body: { ...changes, version: version ?? base.version },
      });
      setBase(saved);
      setConflict(null);
      form.reset(toValues(saved));
      setMessage('Saved.');
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.body.current
      )
        setConflict(err.body.current as Patient);
      else if (!applyServerErrors(err, form.setError))
        setMessage(errorMessage(err));
    }
  };

  const onDelete = async () => {
    if (!base) return;
    try {
      await remove.mutateAsync({ id: base.id, version: base.version });
      navigate('/patients', { replace: true });
    } catch (err) {
      setConfirmDelete(false);
      if (
        err instanceof ApiRequestError &&
        err.status === 409 &&
        err.body.current
      )
        setConflict(err.body.current as Patient);
      else setMessage(errorMessage(err));
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit((v) => submit(v))}
      noValidate
      className="max-w-3xl"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/patients"
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← Patients
        </Link>
        <h1 className="grow text-2xl font-semibold">
          {base ? base.pseudonym : 'New patient'}
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
            <span className="text-sm text-slate-600">Delete this patient?</span>
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
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : base ? 'Save changes' : 'Create patient'}
        </button>
      </div>
      {conflict && (
        <ConflictBanner
          onReload={() => {
            qc.setQueryData(patientKeys.detail(conflict.id), conflict);
            setBase(conflict);
            form.reset(toValues(conflict));
            setConflict(null);
          }}
          onOverwrite={form.handleSubmit((v) => submit(v, conflict.version))}
        />
      )}
      {message && (
        <p role="status" className="mb-4 text-sm text-slate-600">
          {message}
        </p>
      )}
      <div className="card grid gap-4 p-5 sm:grid-cols-3">
        <Field
          id="pseudonym"
          label="Pseudonym"
          error={errors.pseudonym?.message}
          hint="e.g. P-0042. Never a real name."
        >
          <input
            className="input"
            {...fieldProps('pseudonym', errors.pseudonym?.message)}
            {...register('pseudonym')}
          />
        </Field>
        <Field id="age" label="Age" error={errors.age?.message}>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            {...fieldProps('age', errors.age?.message)}
            {...register('age', { setValueAs: numberOrNull })}
          />
        </Field>
        <Field id="sex" label="Sex" error={errors.sex?.message}>
          <select
            className="input"
            {...fieldProps('sex', errors.sex?.message)}
            {...register('sex')}
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </Field>
        <Field
          id="conditions"
          label="Conditions"
          error={errors.conditions?.message}
          hint="Press Enter after each"
          className="sm:col-span-3"
        >
          <Controller
            control={control}
            name="conditions"
            render={({ field }) => (
              <TagInput
                id="conditions"
                value={field.value}
                onChange={field.onChange}
                placeholder="e.g. Type 2 diabetes"
              />
            )}
          />
        </Field>
        <Field
          id="medications"
          label="Medications"
          error={errors.medications?.message}
          className="sm:col-span-3"
        >
          <Controller
            control={control}
            name="medications"
            render={({ field }) => (
              <TagInput
                id="medications"
                value={field.value}
                onChange={field.onChange}
                placeholder="e.g. Metformin 1000 mg"
              />
            )}
          />
        </Field>
        <Field
          id="notes"
          label="Clinical notes"
          error={errors.notes?.message}
          hint="Labs, history. AI matching (coming next) reads this."
          className="sm:col-span-3"
        >
          <textarea
            className="input"
            rows={5}
            {...fieldProps('notes', errors.notes?.message)}
            {...register('notes', { setValueAs: textOrNull })}
          />
        </Field>
      </div>
    </form>
  );
}
