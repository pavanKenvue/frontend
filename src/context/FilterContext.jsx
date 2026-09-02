import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { buildParamIndex, normalizeParamMap } from '../utils/paramMap';

// Shape mirrors the old vanilla `appliedFilters` global:
// { [column]: { values: string[], paramName: string } }
const FilterContext = createContext(null);

function sameValues(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.every((v, i) => v === right[i]);
}

export function FilterProvider({ children }) {
  const [appliedFilters, setAppliedFilters] = useState({});
  // Normalized from /columns — see utils/paramMap.js. The raw payload's
  // orientation is not trusted; these two are always the right way round.
  const [columnToParams, setColumnToParams] = useState({});
  const [paramToColumn, setParamToColumn] = useState({});
  const [numericColumns, setNumericColumns] = useState(new Set());
  // { [column]: { dataType, numDistinct, tier, filterable, requiresSearch } }
  const [columnMeta, setColumnMeta] = useState({});

  // Accepts the raw GET /columns response and normalizes it once.
  const loadParamMap = useCallback((data) => {
    const { columnToParams: c2p, paramToColumn: p2c, reversed } = normalizeParamMap(data);
    if (reversed) {
      console.info('[paramMap] API returned param -> column; normalized to column -> param');
    }
    setColumnToParams(c2p);
    setParamToColumn(p2c);
  }, []);

  const paramIndex = useMemo(() => buildParamIndex(paramToColumn), [paramToColumn]);

  /** Every QuickSight parameter bound to a column. Order is stable. */
  const paramsForColumn = useCallback(
    (column) => columnToParams[column] || [column],
    [columnToParams]
  );

  /** The single canonical parameter to push for a column. */
  const paramForColumn = useCallback(
    (column) => paramsForColumn(column)[0],
    [paramsForColumn]
  );

  /** Reverse lookup: which column does this QuickSight parameter drive? */
  const columnForParam = useCallback(
    (param) => paramIndex.get(String(param).toLowerCase())?.column || null,
    [paramIndex]
  );

  /**
   * True only for parameters that are backed by a Controls filter we know
   * about. QuickSight's PARAMETERS_CHANGED fires for every parameter in the
   * dashboard — including internal ones driven by visual interactions and
   * calculated fields — so this is the gate that keeps the Filter Builder
   * from being flooded with events it should not react to.
   */
  const isControlParam = useCallback(
    (param) => Boolean(param) && paramIndex.has(String(param).toLowerCase()),
    [paramIndex]
  );

  const setColumnFilter = useCallback((col, values, paramName) => {
    setAppliedFilters((prev) => {
      if (!values || !values.length) {
        if (!prev[col]) return prev;
        const next = { ...prev };
        delete next[col];
        return next;
      }
      const nextValues = values.map(String);
      const existing = prev[col];
      const nextParam = paramName || existing?.paramName || col;
      // No-op guard: re-setting identical state would otherwise re-render the
      // whole tree on every echoed QuickSight event.
      if (existing && existing.paramName === nextParam && sameValues(existing.values, nextValues)) {
        return prev;
      }
      return {
        ...prev,
        [col]: { values: nextValues, paramName: nextParam },
      };
    });
  }, []);

  /**
   * Applies a batch of changes that originated in QuickSight, in a single
   * state update. `updates` is [{ column, values, paramName }]; an empty
   * `values` clears that column.
   */
  const applyExternalFilters = useCallback((updates) => {
    if (!updates?.length) return;
    setAppliedFilters((prev) => {
      let changed = false;
      const next = { ...prev };

      updates.forEach(({ column, values, paramName }) => {
        if (!column) return;
        if (!values || !values.length) {
          if (next[column]) {
            delete next[column];
            changed = true;
          }
          return;
        }
        const nextValues = values.map(String);
        const nextParam = paramName || next[column]?.paramName || column;
        const existing = next[column];
        if (existing && existing.paramName === nextParam && sameValues(existing.values, nextValues)) {
          return;
        }
        next[column] = { values: nextValues, paramName: nextParam };
        changed = true;
      });

      return changed ? next : prev;
    });
  }, []);

  const removeFilterValue = useCallback((col, value) => {
    setAppliedFilters((prev) => {
      const existing = prev[col];
      if (!existing) return prev;
      const values = existing.values.filter((v) => String(v) !== String(value));
      const next = { ...prev };
      if (!values.length) {
        delete next[col];
      } else {
        next[col] = { ...existing, values };
      }
      return next;
    });
  }, []);

  const clearColumn = useCallback((col) => {
    setAppliedFilters((prev) => {
      if (!prev[col]) return prev;
      const next = { ...prev };
      delete next[col];
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setAppliedFilters({});
  }, []);

  // Build the previous_filters payload for /filter_multiple_values,
  // excluding the column currently being edited (cascading semantics).
  const buildPreviousFilters = useCallback(
    (excludeColumn) =>
      Object.entries(appliedFilters)
        .filter(([col]) => col !== excludeColumn)
        .map(([col, f]) => ({ column_name: col, values: f.values })),
    [appliedFilters]
  );

  const value = useMemo(
    () => ({
      appliedFilters,
      setAppliedFilters,
      columnToParams,
      paramToColumn,
      loadParamMap,
      paramsForColumn,
      paramForColumn,
      columnForParam,
      isControlParam,
      numericColumns,
      setNumericColumns,
      columnMeta,
      setColumnMeta,
      setColumnFilter,
      applyExternalFilters,
      removeFilterValue,
      clearColumn,
      clearAllFilters,
      buildPreviousFilters,
    }),
    [
      appliedFilters,
      columnToParams,
      paramToColumn,
      loadParamMap,
      paramsForColumn,
      paramForColumn,
      columnForParam,
      isControlParam,
      numericColumns,
      columnMeta,
      setColumnFilter,
      applyExternalFilters,
      removeFilterValue,
      clearColumn,
      clearAllFilters,
      buildPreviousFilters,
    ]
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within a FilterProvider');
  return ctx;
}
