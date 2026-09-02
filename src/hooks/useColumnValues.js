import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFilterMultipleValues } from '../api/filters';
import { useFilters } from '../context/FilterContext';
import { filterValuesByOp, parseNumericOp } from '../utils/numericOps';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Drives the value checklist for whichever column is open in the Filter Builder.
 *
 * One call per load. `previous_filters` carries every OTHER column's current
 * selection, so the API returns only the values that co-occur with them — pick
 * COUNTRY=INDIA, open STATE, and the list is Indian states and nothing else.
 * Change COUNTRY and the list refetches against the new selection.
 *
 * The column being edited is excluded from its own filters (buildPreviousFilters
 * does that), otherwise opening COUNTRY again would show only INDIA and there
 * would be no way to change the selection.
 *
 * This previously issued two calls — an unfiltered list plus a cascaded one —
 * and greyed out the difference. The list is now filtered server-side, so
 * invalid values are absent rather than disabled.
 *
 * Search is sent to the server as `q` rather than filtered in the browser.
 * The old client-side approach only ever searched the first 200 values, so a
 * column with 5,000 values silently hid most matches. Numeric operators
 * (">50") still filter client-side, since the API has no operator syntax.
 */
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

  // Every other column's selection. Referentially stable between filter
  // changes, because buildPreviousFilters is memoised on appliedFilters —
  // so this can safely be an effect dependency.
  const previousFilters = useMemo(
    () => (column ? buildPreviousFilters(column) : []),
    [buildPreviousFilters, column]
  );

  // Numeric operator input (">50") is not a server-side search term — it has
  // to filter the loaded page locally, so don't send it as `q`.
  //
  // Deliberately NOT gated on isNumericColumn: that flag comes from
  // /columns/describe, a second API call that can take several seconds to
  // resolve after a column is opened. Gating on it meant a token like "<500"
  // typed before that call landed fell straight through to the server as a
  // literal substring search — which matches nothing — with no way to
  // recover once the metadata did arrive. Parsing the operator syntax
  // straight from what's typed makes this deterministic regardless of that
  // race, at the cost of a rare, low-stakes edge case: a text column value
  // that is itself an operator-looking string (e.g. "<pending>") won't be
  // reachable by typing it into this box.
  const opMatch = useMemo(
    () => (searchTerm.trim() ? parseNumericOp(searchTerm.trim()) : null),
    [searchTerm]
  );

  // True the moment an operator character appears, even before the number
  // after it is fully typed (e.g. "<" alone, mid-keystroke on the way to
  // "<500"). Without this, that half-typed "<" round-trips to the server as
  // a literal text search — which matches nothing — and once the digits
  // land and opMatch turns non-null, the reload effect below never re-fires
  // (debouncedTerm didn't change), so it's left filtering an emptied list.
  const looksLikeOperator = /^[<>=]/.test(searchTerm.trim());

  useEffect(() => {
    if (opMatch || looksLikeOperator) return; // never round-trip an operator expression
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
        // Expected for very high-cardinality columns: the API refuses to list
        // millions of values until the user narrows it down.
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

  // Reload on column change, on a new search term, and whenever another
  // column's selection changes — the last one is what makes STATE follow
  // COUNTRY when COUNTRY is edited.
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column, debouncedTerm, previousFilters]);

  const loadMore = useCallback(async () => {
    if (!column || !hasMore || nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      // fetchPage carries previousFilters, so page 2 stays within the cascade.
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

  // An operator ("<500") only filters what's already loaded, which is capped
  // at PAGE_SIZE — a column with more values than that needs "Load more"
  // clicked first for the operator to see the rest. (An earlier version of
  // this auto-paged in the background while an operator was active, but that
  // loops forever on a high-cardinality column: each page keeps hasMore
  // true, so it never stops calling loadMore().)

  // Only numeric-operator filtering happens locally now; plain text search is
  // already applied server-side.
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
