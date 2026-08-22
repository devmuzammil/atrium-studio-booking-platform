import type { ApiErrorBody } from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly correlationId?: string;
  readonly body?: ApiErrorBody;

  constructor(status: number, message: string, correlationId?: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.correlationId = correlationId;
    this.body = body;
  }
}

type TokenProvider = () => string | null;
type UnauthorizedHandler = () => void;

let getToken: TokenProvider = () => null;
let onUnauthorized: UnauthorizedHandler = () => undefined;

export function configureApiClient(options: {
  getToken: TokenProvider;
  onUnauthorized: UnauthorizedHandler;
}): void {
  getToken = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const correlationId = response.headers.get('x-request-id') ?? undefined;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { error: text };
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      onUnauthorized();
    }
    const errorBody = (body && typeof body === 'object' ? body : {}) as ApiErrorBody;
    const message = errorBody.error || errorBody.message || defaultMessage(response.status);
    throw new ApiError(response.status, message, correlationId, errorBody);
  }

  return body as T;
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'Please check your input and try again.';
    case 401:
      return 'Please sign in again.';
    case 403:
      return 'You are not allowed to access this resource.';
    case 404:
      return 'The requested resource was not found.';
    case 409:
      return 'This action conflicts with the current booking state.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
