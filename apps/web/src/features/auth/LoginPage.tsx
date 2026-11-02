import { zodResolver } from '@hookform/resolvers/zod';
import {
  LoginSchema,
  RegisterSchema,
  type LoginInput,
  type RegisterInput,
} from '@trialmatch/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Field, fieldProps } from '../../components/Field';
import { errorMessage } from '../../lib/api';
import { safeReturnPath, useAuth } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { user, login, register: signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [formError, setFormError] = useState<string | null>(null);
  const returnTo = safeReturnPath(
    (location.state as { from?: unknown } | null)?.from,
  );

  const form = useForm<RegisterInput>({
    resolver: zodResolver(
      mode === 'login' ? LoginSchema : RegisterSchema,
    ) as never,
    defaultValues: { email: '', password: '', displayName: '' },
  });
  const { register, handleSubmit, formState, setError } = form;
  const errors = formState.errors;

  if (user) return <Navigate to={returnTo} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (mode === 'login') await login(values as LoginInput);
      else await signUp(values);
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (!applyServerErrors(err, setError)) setFormError(errorMessage(err));
    }
  });

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setFormError(null);
    form.clearErrors();
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-slate-900">
          {mode === 'login' ? 'Sign in to TrialMatch' : 'Create your account'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Match patients to clinical trials.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          {formError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            >
              {formError}
            </p>
          )}
          {mode === 'register' && (
            <Field
              id="displayName"
              label="Your name"
              error={errors.displayName?.message}
            >
              <input
                className="input"
                autoComplete="name"
                {...fieldProps('displayName', errors.displayName?.message)}
                {...register('displayName')}
              />
            </Field>
          )}
          <Field id="email" label="Email" error={errors.email?.message}>
            <input
              className="input"
              type="email"
              autoComplete="email"
              {...fieldProps('email', errors.email?.message)}
              {...register('email')}
            />
          </Field>
          <Field
            id="password"
            label="Password"
            error={errors.password?.message}
            hint={mode === 'register' ? 'At least 10 characters' : undefined}
          >
            <input
              className="input"
              type="password"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              {...fieldProps('password', errors.password?.message)}
              {...register('password')}
            />
          </Field>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={formState.isSubmitting}
          >
            {formState.isSubmitting
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <button
            type="button"
            className="font-medium text-brand-700 hover:underline"
            onClick={switchMode}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        {mode === 'login' && (
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            Demo: alice@trialmatch.dev / trialmatch-demo
          </p>
        )}
      </div>
    </div>
  );
}
