import { apiClient } from './client';
import { encryptBookmarkData, decryptBookmarkData } from '../utils/bookmarkCrypto';

export function getColumns(signal) {
  return apiClient.get('/columns', undefined, signal);
}

export function describeColumns(signal) {
  return apiClient.get('/columns/describe', undefined, signal);
}

export function getFilterMultipleValues(
  { currentColumnName, previousFilters = [], q, limit = 50, offset = 0 },
  signal
) {
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

export function getEmbedUrl(signal) {
  return apiClient.get('/', undefined, signal);
}

export function getHealth(signal) {
  return apiClient.get('/health', undefined, signal);
}

export function listBookmarks(signal) {
  return apiClient.get('/bookmarks', undefined, signal);
}

export async function getBookmark(id, signal) {
  const data = await apiClient.get(`/bookmark?id=${id}`, undefined, signal);
  if (data?.encrypted && data?.iv) {
    const filters = await decryptBookmarkData(data.encrypted, data.iv);
    return { ...data, filters };
  }
  return data;
}

export async function createBookmark({ name, filters }, signal) {
  const { encrypted, iv } = await encryptBookmarkData(filters);
  return apiClient.post('/bookmark', { name, encrypted, iv }, signal);
}

export function renameBookmark(id, name, signal) {
  return apiClient.put(`/bookmark?id=${id}`, { name }, signal);
}

export async function updateBookmarkFilters(id, filters, signal) {
  const { encrypted, iv } = await encryptBookmarkData(filters);
  return apiClient.put(`/bookmarks/${encodeURIComponent(id)}`, { encrypted, iv }, signal);
}

export function deleteBookmark(id, signal) {
  return apiClient.delete(`/bookmark?id=${id}`, undefined, signal);
}
