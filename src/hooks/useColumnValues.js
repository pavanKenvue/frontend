import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFilterMultipleValues } from '../api/filters';
import { useFilters } from '../context/FilterContext';
import { filterValuesByOp, parseNumericOp } from '../utils/numericOps';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export function useColumnValues(column) {
  const { buildPreviousFilters, numericColumns, columnMeta } = useFilters();

  const [allValues, setAllValues] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [needsSearch, setNeedsSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [source, setSource] = useState(null);

  const abortRef = useRef(null);

  const isNumericColumn = column ? numericColumns.has(column) : false;
  const meta = column ? columnMeta?.[column] : null;

  const previousFilters = useMemo(
    () => (column ? buildPreviousFilters(column) : []),
    [buildPreviousFilters, column]
  );

  const opMatch = useMemo(
    () => (searchTerm.trim() ? parseNumericOp(searchTerm.trim()) : null),
    [searchTerm]
  );

  const looksLikeOperator = /^[<>=]/.test(searchTerm.trim());

  useEffect(() => {
    if (opMatch || looksLikeOperator) return;
    const t = setTimeout(() => setDebouncedTerm(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm, opMatch, looksLikeOperator]);

  const fetchPage = useCallback(
    async ({ q, offset, signal }) =>
      getFilterMultipleValues(
        {
          currentColumnName: column,
          previousFilters,
          q: q || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        signal
      ),
    [column, previousFilters]
  );

  const load = useCallback(async () => {
    if (!column) {
      setAllValues([]);
      setHasMore(false);
      setNeedsSearch(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setNeedsSearch(false);

    try {
      const res = await fetchPage({ q: debouncedTerm, offset: 0, signal: controller.signal });
      setAllValues((res?.values || []).map(String));
      setHasMore(Boolean(res?.hasMore));
      setNextOffset(res?.nextOffset ?? null);
      setSource(res?.source ?? null);
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.type === 'SearchTermRequired') {
        setNeedsSearch(true);
        setAllValues([]);
        setHasMore(false);
      } else {
        setError(e.message || 'Failed to load values');
        setAllValues([]);
      }
    } finally {
      setLoading(false);
    }
  }, [column, debouncedTerm, fetchPage]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [column, debouncedTerm, previousFilters]);

  const loadMore = useCallback(async () => {
    if (!column || !hasMore || nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage({ q: debouncedTerm, offset: nextOffset });
      const more = (res?.values || []).map(String);
      setAllValues((prev) => [...new Set([...prev, ...more])]);
      setHasMore(Boolean(res?.hasMore));
      setNextOffset(res?.nextOffset ?? null);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Failed to load more values');
    } finally {
      setLoadingMore(false);
    }
  }, [column, hasMore, nextOffset, loadingMore, debouncedTerm, fetchPage]);

  const displayedValues = useMemo(() => {
    if (opMatch) return filterValuesByOp(allValues, opMatch.op, opMatch.num);
    return allValues;
  }, [allValues, opMatch]);

  const searchPending = searchTerm.trim() !== debouncedTerm && !opMatch && !looksLikeOperator;

  return {
    allValues,
    displayedValues,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    error,
    needsSearch,
    searchTerm,
    setSearchTerm,
    searchPending,
    isNumericColumn,
    columnInfo: meta,
    source,
    reload: load,
  };
}
