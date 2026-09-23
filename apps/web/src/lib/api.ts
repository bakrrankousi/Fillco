import type { Problem } from '@fillco/contracts';

/** Error returned by the API as RFC 7807 problem details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string[]>;
  readonly data: unknown;

  constructor(problem: Problem) {
    super(problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code ?? 'ERROR';
    this.fieldErrors = problem.errors ?? {};
    this.data = problem.data;
  }
}

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(
      payload && typeof payload === 'object' && 'title' in payload
        ? (payload as Problem)
        : { type: 'about:blank', title: `Request failed (${res.status})`, status: res.status },
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Triggers a browser download of an Excel export for a list endpoint. */
export async function downloadExport(path: string, query?: Query): Promise<void> {
  const res = await fetch(
    `/api/v1${withQuery(path, { ...query, format: 'xlsx', page: undefined, pageSize: undefined })}`,
    {
      credentials: 'same-origin',
    },
  );
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    throw new ApiError(problem ?? { type: 'about:blank', title: 'Export failed', status: res.status });
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
