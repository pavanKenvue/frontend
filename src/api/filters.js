import { apiClient } from './client';
import { encryptBookmarkData, decryptBookmarkData } from '../utils/bookmarkCrypto';

export function getColumns(signal) {
  return apiClient.get('/columns', undefined, signal);
}

/**
 * GET /columns/describe — per-column data type, cardinality and tier.
 * Used to know which columns need a search term before they will list values.
 */
export function describeColumns(signal) {
  return apiClient.get('/columns/describe', undefined, signal);
}

/**
 * POST /filter_multiple_values — the cascading values endpoint.
 *
 * Request:
 * {
 *   current_column_name: string,
 *   previous_filters?: [{ column_name: string, values: string[] }],
 *   q?: string,        // server-side search within the current column
 *   limit?: number,
 *   offset?: number
 * }
 *
 * `previous_filters` is optional. Omit it (or send [] / null) to get the
 * unrestricted values of current_column_name. When it is present, the response
 * contains only values that co-occur with those filters — so the caller can
 * render the result directly instead of cross-referencing two lists.
 *
 * Response:
 * {
 *   column, values: string[], counts: {value:count}|null,
 *   offset, limit, hasMore, nextOffset,
 *   source: 'dict'|'facets'|'base'|'…+cache', elapsedMs
 * }
 *
 * There is no `total`: counting distinct values exactly costs a second full
 * pass over the fact table, so the API over-fetches by one row and reports
 * `hasMore` instead. Use that for "showing N — refine your search".
 *
 * NOTE: the filter key is `column_name`. The backend also accepts `column` as
 * an alias, but sending `column_name` is the documented contract.
 */
export function getFilterMultipleValues(
  { currentColumnName, previousFilters = [], q, limit = 50, offset = 0 },
  signal
) {
  // Drop filters that carry no values: an empty selection means "not filtering
  // on this column", and sending it would ask the API to match nothing.
  const filters = (previousFilters || [])
    .filter((f) => f && (f.column_name ?? f.column) && f.values?.length)
    .map((f) => ({
      column_name: f.column_name ?? f.column,
      values: f.values.map(String),
    }));

  return apiClient.post(
    '/filter_multiple_values',
    {
      current_column_name: currentColumnName,
      ...(filters.length ? { previous_filters: filters } : {}),
      ...(q ? { q } : {}),
      limit,
      offset,
    },
    signal
  );
}

export function searchAllColumns({ q, limit = 10, columns }, signal) {
  return apiClient.get(
    '/search',
    {
      query: q,
      limit,
      ...(columns ? { columns } : {}),
    },
    signal
  );
}

/** GET / (alias: /quicksight/embed-url) -> { embedUrl } */
export function getEmbedUrl(signal) {
  return apiClient.get('/', undefined, signal);
}

/** GET /health -> liveness plus registry, facet-layer and cache diagnostics. */
export function getHealth(signal) {
  return apiClient.get('/health', undefined, signal);
}

// ---------------------------------------------------------------------------
// Bookmarks — saved filter sets, stored server-side.
// ---------------------------------------------------------------------------

/** -> { bookmarks: [{ id, name, createdAt, updatedAt, filterCount }] } */
export function listBookmarks(signal) {
  return apiClient.get('/bookmarks', undefined, signal);
}

/**
 * -> { id, name, createdAt, updatedAt, filters }
 *
 * The backend stores/returns filters only as an opaque { encrypted, iv }
 * pair (see createBookmark() below) — decrypted here, client-side, back into
 * the plain FilterContext shape before handing it to the rest of the app.
 * Falls back to a bare `filters` field as-is if the response ever comes back
 * unencrypted (e.g. an older record saved before this existed).
 */
export async function getBookmark(id, signal) {
  const data = await apiClient.get(`/bookmark?id=${id}`, undefined, signal);
  if (data?.encrypted && data?.iv) {
    const filters = await decryptBookmarkData(data.encrypted, data.iv);
    return { ...data, filters };
  }
  return data;
}

/**
 * `filters` is the FilterContext shape: { [column]: { values, paramName } } —
 * encrypted client-side (AES-GCM, see ../utils/bookmarkCrypto.js) before it
 * ever leaves the browser. The backend only ever sees/stores the opaque
 * { encrypted, iv } pair, never the plain filter values.
 */
export async function createBookmark({ name, filters }, signal) {
  const { encrypted, iv } = await encryptBookmarkData(filters);
  return apiClient.post('/bookmark', { name, encrypted, iv }, signal);
}

export function renameBookmark(id, name, signal) {
  return apiClient.put(`/bookmark?id=${id}`, { name }, signal);
}

/** Same client-side encryption as createBookmark() — see the note there. */
export async function updateBookmarkFilters(id, filters, signal) {
  const { encrypted, iv } = await encryptBookmarkData(filters);
  return apiClient.put(`/bookmarks/${encodeURIComponent(id)}`, { encrypted, iv }, signal);
}

export function deleteBookmark(id, signal) {
  return apiClient.delete(`/bookmark?id=${id}`, undefined, signal);
}
