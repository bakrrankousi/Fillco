'use client';

import { useCallback, useState } from 'react';
import type { ZodTypeAny } from 'zod';
import { ApiError } from './api';

export type FieldErrors = Record<string, string[]>;

/** Runs a shared contract schema in the browser so users see the same errors the API would return. */
export function validate<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
): { ok: true; data: ReturnType<S['parse']> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    (errors[key] ??= []).push(issue.message);
  }
  return { ok: false, errors };
}

/** Small controlled-form helper: values, per-field errors, and API error mapping. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  }, []);

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
      setErrors(err.fieldErrors);
      setFormError(err);
    } else {
      setFormError(err);
    }
  }, []);

  const reset = useCallback((next: T) => {
    setValues(next);
    setErrors({});
    setFormError(null);
  }, []);

  return { values, set, setValues, errors, setErrors, formError, setFormError, fail, reset };
}

/** Empty strings become undefined so optional fields are simply omitted. */
export function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === '' ? null : v])) as T;
}
