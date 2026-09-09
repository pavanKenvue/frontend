const RAW_BASE = import.meta.env.VITE_API_BASE_URL;
const BASE_URL = RAW_BASE.replace(/\/$/, '');

const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 30000);

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.type = body?.type ?? null;
  }

  get isRetryable() {
    return this.status === 503 || this.status === 504;
  }
}

function messageFrom(data, status) {
  if (data && typeof data === 'object') {
    if (Array.isArray(data.detail) && data.detail.length) {
      return data.detail.map((d) => d.msg || String(d)).join('; ');
    }
    if (typeof data.detail === 'string') return data.detail;
    if (data.error) return data.error;
    if (data.message) return data.message;
  }
  if (typeof data === 'string' && data.trim()) return data.trim();
  return `Request failed: ${status}`;
}

async function request(path, { method = 'GET', body, params, signal, timeoutMs } = {}) {
  let url = `${BASE_URL}${path}`;

  if (params && Object.keys(params).length) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const qsStr = qs.toString();
    if (qsStr) url += `?${qsStr}`;
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const signals = [timeoutController.signal];
  if (signal) signals.push(signal);
  const composed =
    typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : timeoutController.signal;

  if (signal && typeof AbortSignal.any !== 'function') {
    signal.addEventListener('abort', () => timeoutController.abort(signal.reason), { once: true });
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: composed,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new ApiError('The request timed out. Please try again.', 408, { type: 'Timeout' });
    }
    throw new ApiError(
      `Cannot reach the API${BASE_URL ? ` at ${BASE_URL}` : ''}. Is the backend running?`,
      0,
      { type: 'NetworkError' }
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status, data);
  return data;
}

export const apiClient = {
  get: (path, params, signal) => request(path, { method: 'GET', params, signal }),
  post: (path, body, signal) => request(path, { method: 'POST', body, signal }),
  put: (path, body, signal) => request(path, { method: 'PUT', body, signal }),
  delete: (path, params, signal) => request(path, { method: 'DELETE', params, signal }),
};

export { ApiError, BASE_URL };
