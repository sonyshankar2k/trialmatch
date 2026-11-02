import { zodResolver } from '@hookform/resolvers/zod';
import {
  CRITERION_TYPES,
  SEXES,
  STATUS_LABELS,
  TRIAL_PHASES,
  TRIAL_STATUSES,
  TrialCreateSchema,
  type Trial,
  type TrialCreateInput,
} from '@trialmatch/shared';
import { useFieldArray, useForm } from 'react-hook-form';
import { Field, fieldProps } from '../../components/Field';
import { numberOrNull, textOrNull } from '../../lib/forms';

export type TrialFormValues = TrialCreateInput & {
  criteria: NonNullable<TrialCreateInput['criteria']>;
};

export function toFormValues(trial?: Trial): TrialFormValues {
  return {
    nctId: trial?.nctId ?? null,
    title: trial?.title ?? '',
    condition: trial?.condition ?? '',
    phase: trial?.phase ?? 'Phase 2',
    status: trial?.status ?? 'not_yet_recruiting',
    sponsor: trial?.sponsor ?? null,
    summary: trial?.summary ?? null,
    minAge: trial?.minAge ?? null,
    maxAge: trial?.maxAge ?? null,
    sex: trial?.sex ?? 'all',
    criteria: trial?.criteria.map(({ type, text }) => ({ type, text })) ?? [],
  };
}

/**
 * Create/edit form. Validation uses the same Zod schema as the API, so the
 * browser and the server never disagree about what is valid.
 */
export function useTrialForm(trial?: Trial) {
  return useForm<TrialFormValues>({
    resolver: zodResolver(TrialCreateSchema) as never,
    defaultValues: toFormValues(trial),
    mode: 'onTouched',
  });
}

export function TrialFormFields({
  form,
}: {
  form: ReturnType<typeof useTrialForm>;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;
  const criteria = useFieldArray({ control, name: 'criteria' });
  const e = (name: keyof TrialFormValues) =>
    errors[name]?.message as string | undefined;

  return (
    <div className="space-y-6">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field
          id="title"
          label="Title"
          error={e('title')}
          className="sm:col-span-2"
        >
          <input
            className="input"
            {...fieldProps('title', e('title'))}
            {...register('title')}
          />
        </Field>
        <Field id="condition" label="Condition" error={e('condition')}>
          <input
            className="input"
            placeholder="e.g. Type 2 diabetes"
            {...fieldProps('condition', e('condition'))}
            {...register('condition')}
          />
        </Field>
        <Field
          id="nctId"
          label="NCT ID"
          error={e('nctId')}
          hint="Optional until registered"
        >
          <input
            className="input"
            placeholder="NCT01234567"
            {...fieldProps('nctId', e('nctId'))}
            {...register('nctId', { setValueAs: textOrNull })}
          />
        </Field>
        <Field id="phase" label="Phase" error={e('phase')}>
          <select
            className="input"
            {...fieldProps('phase', e('phase'))}
            {...register('phase')}
          >
            {TRIAL_PHASES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field id="status" label="Status" error={e('status')}>
          <select
            className="input"
            {...fieldProps('status', e('status'))}
            {...register('status')}
          >
            {TRIAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="sponsor" label="Sponsor" error={e('sponsor')}>
          <input
            className="input"
            {...fieldProps('sponsor', e('sponsor'))}
            {...register('sponsor', { setValueAs: textOrNull })}
          />
        </Field>
        <Field id="sex" label="Sex" error={e('sex')}>
          <select
            className="input"
            {...fieldProps('sex', e('sex'))}
            {...register('sex')}
          >
            {SEXES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="minAge" label="Minimum age" error={e('minAge')}>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            {...fieldProps('minAge', e('minAge'))}
            {...register('minAge', { setValueAs: numberOrNull })}
          />
        </Field>
        <Field id="maxAge" label="Maximum age" error={e('maxAge')}>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            {...fieldProps('maxAge', e('maxAge'))}
            {...register('maxAge', { setValueAs: numberOrNull })}
          />
        </Field>
        <Field
          id="summary"
          label="Summary"
          error={e('summary')}
          className="sm:col-span-2"
        >
          <textarea
            className="input"
            rows={3}
            {...fieldProps('summary', e('summary'))}
            {...register('summary', { setValueAs: textOrNull })}
          />
        </Field>
      </div>

      <fieldset className="card p-5">
        <legend className="sr-only">Eligibility criteria</legend>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Eligibility criteria</h2>
          <div className="flex gap-2">
            {CRITERION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="btn-secondary"
                onClick={() =>
                  criteria.append({ type, text: '' }, { shouldFocus: true })
                }
              >
                Add {type}
              </button>
            ))}
          </div>
        </div>
        {criteria.fields.length === 0 && (
          <p className="text-sm text-slate-500">No criteria yet.</p>
        )}
        <ol className="space-y-2">
          {criteria.fields.map((field, i) => {
            const textError = errors.criteria?.[i]?.text?.message;
            const id = `criteria-${i}-text`;
            return (
              <li key={field.id} className="flex items-start gap-2">
                <select
                  className="input w-32 shrink-0"
                  aria-label={`Criterion ${i + 1} type`}
                  {...register(`criteria.${i}.type`)}
                >
                  <option value="inclusion">Inclusion</option>
                  <option value="exclusion">Exclusion</option>
                </select>
                <div className="grow">
                  <input
                    className="input"
                    aria-label={`Criterion ${i + 1} text`}
                    {...fieldProps(id, textError)}
                    {...register(`criteria.${i}.text`)}
                  />
                  {textError && (
                    <p
                      id={`${id}-error`}
                      role="alert"
                      className="mt-1 text-xs text-red-600"
                    >
                      {textError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary px-2"
                  aria-label={`Move criterion ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => criteria.move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2"
                  aria-label={`Move criterion ${i + 1} down`}
                  disabled={i === criteria.fields.length - 1}
                  onClick={() => criteria.move(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-danger px-2"
                  aria-label={`Remove criterion ${i + 1}`}
                  onClick={() => criteria.remove(i)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      </fieldset>
    </div>
  );
}
