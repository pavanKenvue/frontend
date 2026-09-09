import { useCallback, useRef, useState } from 'react';
import {
  createBookmark,
  deleteBookmark,
  getBookmark,
  listBookmarks,
  renameBookmark,
} from '../api/filters';
import { useFilters } from '../context/FilterContext';

export function useBookmarks({ onApplied } = {}) {
  const { appliedFilters, setAppliedFilters } = useFilters();
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
      onApplied?.(
        Object.fromEntries(
          Object.entries(filters)
            .filter(([, f]) => f?.values?.length)
            .map(([col, f]) => [col, f.values])
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
