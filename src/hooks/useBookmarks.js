import { useCallback, useRef, useState } from 'react';
import {
  createBookmark,
  deleteBookmark,
  getBookmark,
  listBookmarks,
  renameBookmark,
} from '../api/filters';
import { useFilters } from '../context/FilterContext';

/**
 * Saved filter sets. A bookmark stores the FilterContext shape verbatim
 * ({ [column]: { values, paramName } }), so opening one is just setting state
 * and re-pushing every parameter to QuickSight.
 */
export function useBookmarks({ onApplied } = {}) {
  const { appliedFilters, setAppliedFilters } = useFilters();
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Full { filters } payload per bookmark id, fetched on demand (expanding a
  // row's detail view, or building its local PDF) and cached so re-opening
  // the same row doesn't re-fetch. listBookmarks() only returns metadata
  // (filterCount) — the filter values themselves live behind getBookmark(id).
  const detailCacheRef = useRef({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBookmarks();
      setBookmarks(data?.bookmarks || []);
    } catch (e) {
      setError(e.message || 'Failed to load bookmarks');
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (name) => {
      if (!name?.trim()) throw new Error('Bookmark name is required');
      const created = await createBookmark({ name: name.trim(), filters: appliedFilters });
      await refresh();
      return created;
    },
    [appliedFilters, refresh]
  );

  const getFilters = useCallback(async (id) => {
    if (detailCacheRef.current[id]) return detailCacheRef.current[id];
    const record = await getBookmark(id);
    const filters = record?.filters || {};
    detailCacheRef.current[id] = filters;
    return filters;
  }, []);

  const open = useCallback(
    async (id) => {
      const record = await getBookmark(id);
      const filters = record?.filters || {};
      detailCacheRef.current[id] = filters;
      setAppliedFilters(filters);
      // Re-push every saved parameter so the dashboard matches the sidebar.
      onApplied?.(
        Object.fromEntries(
          Object.values(filters)
            .filter((f) => f?.paramName)
            .map((f) => [f.paramName, f.values])
        )
      );
      return record;
    },
    [setAppliedFilters, onApplied]
  );

  const rename = useCallback(
    async (id, name) => {
      await renameBookmark(id, name);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id) => {
      await deleteBookmark(id);
      delete detailCacheRef.current[id];
      await refresh();
    },
    [refresh]
  );

  return { bookmarks, loading, error, refresh, save, open, rename, remove, getFilters };
}
