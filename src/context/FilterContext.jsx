import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { buildParamIndex, normalizeParamMap } from '../utils/paramMap';
import columnDatasetMap from '../../column_dataset_map.json';

function filterGroupColumnsFromDatasetMap() {
  const cols = new Set();
  Object.entries(columnDatasetMap).forEach(([col, entries]) => {
    if (Array.isArray(entries) && entries.length && entries.every((e) => !e.parameter)) {
      cols.add(col);
    }
  });
  return cols;
}

const FilterContext = createContext(null);

function sameValues(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.every((v, i) => v === right[i]);
}

export function FilterProvider({ children }) {
  const [appliedFilters, setAppliedFilters] = useState({});
  const [columnToParams, setColumnToParams] = useState({});
  const [paramToColumn, setParamToColumn] = useState({});
  const [numericColumns, setNumericColumns] = useState(new Set());
  const [columnMeta, setColumnMeta] = useState({});
  const [filterGroupColumns, setFilterGroupColumns] = useState(filterGroupColumnsFromDatasetMap);
  const [datasetMap, setDatasetMap] = useState({});
  const [crossDatasetColumns, setCrossDatasetColumns] = useState(new Set());
  const [defaultDatasetIdentifier, setDefaultDatasetIdentifier] = useState('');

  const loadParamMap = useCallback((data) => {
    const { columnToParams: c2p, paramToColumn: p2c, reversed } = normalizeParamMap(data);
    if (reversed) {
      console.info('[paramMap] API returned param -> column; normalized to column -> param');
    }
    setColumnToParams(c2p);
    setParamToColumn(p2c);
    if (Array.isArray(data?.filterGroupColumns)) {
      setFilterGroupColumns(new Set(data.filterGroupColumns.map(String)));
      console.log('[filterGroups] filterGroupColumns loaded from backend:', data.filterGroupColumns);
    } else {
      setFilterGroupColumns((prev) => {
        console.warn(
          '[filterGroups] Backend /columns had no "filterGroupColumns" array — keeping the hardcoded fallback',
          [...prev]
        );
        return prev;
      });
    }
    if (data?.datasetMap && typeof data.datasetMap === 'object') {
      setDatasetMap(data.datasetMap);
      console.log('[filterGroups] datasetMap loaded from backend:', data.datasetMap);
    } else {
      console.warn(
        '[filterGroups] Backend /columns had no "datasetMap" object — FilterGroups columns will fall back to the bundled column_dataset_map.json / default dataset identifier'
      );
    }
    if (Array.isArray(data?.crossDatasetColumns)) {
      setCrossDatasetColumns(new Set(data.crossDatasetColumns.map(String)));
      console.log('[filterGroups] crossDatasetColumns loaded from backend:', data.crossDatasetColumns);
    } else {
      console.warn(
        '[filterGroups] Backend /columns had no "crossDatasetColumns" array — every FilterGroups column will use CrossDataset: SINGLE_DATASET'
      );
    }
    if (typeof data?.defaultDatasetIdentifier === 'string' && data.defaultDatasetIdentifier) {
      setDefaultDatasetIdentifier(data.defaultDatasetIdentifier);
    }
  }, []);

  const paramIndex = useMemo(() => buildParamIndex(paramToColumn), [paramToColumn]);

  const paramsForColumn = useCallback(
    (column) => columnToParams[column] || [column],
    [columnToParams]
  );

  const paramForColumn = useCallback(
    (column) => paramsForColumn(column)[0],
    [paramsForColumn]
  );

  const columnForParam = useCallback(
    (param) => paramIndex.get(String(param).toLowerCase())?.column || null,
    [paramIndex]
  );

  const isControlParam = useCallback(
    (param) => Boolean(param) && paramIndex.has(String(param).toLowerCase()),
    [paramIndex]
  );

  const isFilterGroupColumn = useCallback(
    (column) => filterGroupColumns.has(column),
    [filterGroupColumns]
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
      if (existing && existing.paramName === nextParam && sameValues(existing.values, nextValues)) {
        return prev;
      }
      return {
        ...prev,
        [col]: { values: nextValues, paramName: nextParam },
      };
    });
  }, []);

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
      filterGroupColumns,
      isFilterGroupColumn,
      datasetMap,
      crossDatasetColumns,
      defaultDatasetIdentifier,
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
      filterGroupColumns,
      isFilterGroupColumn,
      datasetMap,
      crossDatasetColumns,
      defaultDatasetIdentifier,
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
