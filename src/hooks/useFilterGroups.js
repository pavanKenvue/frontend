import { useCallback, useEffect, useRef } from 'react';
import { useFilters } from '../context/FilterContext';
import columnDatasetMap from '../../column_dataset_map.json';

const FALLBACK_QS_DATASET_IDENTIFIER = import.meta.env.VITE_QS_DATASET_IDENTIFIER || '';
const POLL_INTERVAL_MS = 10000;

function fallbackDatasetIdentifierForColumn(col) {
  const entries = columnDatasetMap[col];
  const name = Array.isArray(entries) && entries.length ? entries[0].dataset_identifier_name : null;
  return name || FALLBACK_QS_DATASET_IDENTIFIER;
}

function isFilterGroupTranslationNoise(reason) {
  if (!reason) return false;
  if (reason.name === 'FilterGroupTranslationError') return true;
  const message = typeof reason === 'string' ? reason : reason.message || '';
  return message.includes('FilterGroupTranslationError') || message.includes('no valid visual ids');
}

function extractBrokenFilterGroupId(reason) {
  if (!reason) return null;
  const blob = `${reason.stack || ''} ${reason.message || ''}`;
  const match = blob.match(/"filterGroupId"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

const GET_FILTER_GROUPS_TIMEOUT_MS = 4000;
const FETCH_TIMED_OUT = Symbol('filter-groups-fetch-timed-out');
async function getFilterGroupsForSheetSafe(dashboard, sheetId) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(FETCH_TIMED_OUT), GET_FILTER_GROUPS_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([dashboard.getFilterGroupsForSheet(sheetId), timeout]);
    if (result === FETCH_TIMED_OUT) {
      console.warn(
        '[filter-groups] getFilterGroupsForSheet did not settle within',
        GET_FILTER_GROUPS_TIMEOUT_MS,
        'ms -- likely a stray unparseable native FilterGroup on this sheet ' +
          '(FilterGroupTranslationError / "no valid visual ids"). Proceeding as ' +
          'if none were found this round instead of hanging.'
      );
      return [];
    }
    return result || [];
  } finally {
    clearTimeout(timer);
  }
}

export function useFilterGroups(embedRef, dashboardReady) {
  const { filterGroupColumns, datasetMap, crossDatasetColumns, defaultDatasetIdentifier, setColumnFilter, clearColumn } =
    useFilters();

  const sheetIdRef = useRef(null);
  const nativeFilterGroupIdRef = useRef({});
  const nativeFilterIdRef = useRef({});
  const nativeDatasetIdRef = useRef({});
  const nativeCrossDatasetRef = useRef({});
  const knownFilterGroupsRef = useRef({});
  const pendingRef = useRef([]);
  const readyRef = useRef(false);
  const pollBusyRef = useRef(false);
  const autoHealedIdsRef = useRef(new Set());

  const filterGroupIdFor = useCallback(
    (col) => nativeFilterGroupIdRef.current[col] || `fg_${col}`,
    []
  );
  const filterIdFor = useCallback(
    (col) => nativeFilterIdRef.current[col] || filterGroupIdFor(col),
    [filterGroupIdFor]
  );

  // Mirrors argus_fe's datasetIdentifierFor: prefer whatever the dashboard's own
  // native FilterGroup for this column already uses, then the backend-provided
  // datasetMap, then the bundled column_dataset_map.json fallback.
  const datasetIdentifierFor = useCallback(
    (col) =>
      nativeDatasetIdRef.current[col] ||
      datasetMap[col] ||
      defaultDatasetIdentifier ||
      fallbackDatasetIdentifierForColumn(col),
    [datasetMap, defaultDatasetIdentifier]
  );

  // Mirrors argus_fe's crossDatasetFor: default to SINGLE_DATASET unless the
  // backend explicitly lists this column as shared across datasets, or the
  // dashboard's own native FilterGroup for it already says otherwise.
  const crossDatasetFor = useCallback(
    (col) => {
      if (Object.prototype.hasOwnProperty.call(nativeCrossDatasetRef.current, col)) {
        return nativeCrossDatasetRef.current[col];
      }
      return crossDatasetColumns.has(col) ? 'ALL_DATASETS' : 'SINGLE_DATASET';
    },
    [crossDatasetColumns]
  );

  const resolveSheetId = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard) return null;
    try {
      const id = await dashboard.getSelectedSheetId();
      if (id) return id;
    } catch (e) {
    }
    try {
      const sheets = await dashboard.getSheets();
      const first = Array.isArray(sheets) ? sheets[0] : null;
      return first ? first.SheetId || first.Id || null : null;
    } catch (e) {
      console.error('[filter-groups] failed to resolve sheet id:', e.message);
      return null;
    }
  }, [embedRef]);

  
  const buildCategoryFilterGroup = useCallback(
    (col, values, status = 'ENABLED') => {
      return {
        FilterGroupId: filterGroupIdFor(col),
        Filters: [
          {
            CategoryFilter: {
              Column: { ColumnName: col, DataSetIdentifier: datasetIdentifierFor(col) },
              FilterId: filterIdFor(col),
              Configuration: {
                FilterListConfiguration: {
                  MatchOperator: 'CONTAINS',
                  NullOption: 'NON_NULLS_ONLY',
                  CategoryValues: values.map(String),
                },
              },
            },
          },
        ],
        ScopeConfiguration: {
          AllSheets: {}
          // SelectedSheets: {
          //   SheetVisualScopingConfigurations: [{ Scope: 'ALL_VISUALS', SheetId: sheetIdRef.current }],
          // },
        },
        CrossDataset: crossDatasetFor(col),
        Status: status,
      };
    },
    [filterGroupIdFor, filterIdFor, datasetIdentifierFor, crossDatasetFor]
  );

  const discoverNativeFilterGroups = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard || !sheetIdRef.current) return;
    try {
      const groups = await getFilterGroupsForSheetSafe(dashboard, sheetIdRef.current);
      console.log(
        '[filter-groups] FilterGroups present on sheet:',
        (groups || []).map((g) => ({
          FilterGroupId: g.FilterGroupId,
          column: g.Filters?.[0]?.CategoryFilter?.Column?.ColumnName,
          dataSetIdentifier: g.Filters?.[0]?.CategoryFilter?.Column?.DataSetIdentifier,
        }))
      );
      (groups || []).forEach((g) => {
        const cf = g.Filters?.[0]?.CategoryFilter;
        const colName = cf?.Column?.ColumnName;
        console.log("filterGroupColumns ", filterGroupColumns)
        if (!colName || !filterGroupColumns.has(colName) || nativeFilterGroupIdRef.current[colName]) {
          return;
        }
        nativeFilterGroupIdRef.current[colName] = g.FilterGroupId;
        nativeFilterIdRef.current[colName] = cf.FilterId || g.FilterGroupId;
        if (cf.Column?.DataSetIdentifier) {
          nativeDatasetIdRef.current[colName] = cf.Column.DataSetIdentifier;
        }
        if (g.CrossDataset) {
          nativeCrossDatasetRef.current[colName] = g.CrossDataset;
        }
        const vals = cf.Configuration?.FilterListConfiguration?.CategoryValues || [];
        knownFilterGroupsRef.current[colName] = vals.map(String);
        console.log(`[filter-groups] adopted native FilterGroup for "${colName}":`, vals);
      });
    } catch (e) {
      console.error('[filter-groups] discoverNativeFilterGroups failed:', e.message);
    }
  }, [embedRef, filterGroupColumns]);

  const cleanupStaleFilterGroups = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard || !sheetIdRef.current) return;
    const nonNative = [...filterGroupColumns].filter((c) => !nativeFilterGroupIdRef.current[c]);
    if (!nonNative.length) return;
    try {
      const existing = await getFilterGroupsForSheetSafe(dashboard, sheetIdRef.current);
      const staleIds = (existing || [])
        .filter((g) => nonNative.some((c) => g.FilterGroupId === `fg_${c}`))
        .map((g) => g.FilterGroupId);
      if (staleIds.length) {
        await dashboard.removeFilterGroups(staleIds);
        console.log('[filter-groups] cleared', staleIds.length, 'auto-restored FilterGroup(s):', staleIds);
      }
    } catch (e) {
      console.error('[filter-groups] cleanupStaleFilterGroups failed:', e.message);
    }
  }, [embedRef, filterGroupColumns]);

  const applyColumnFilter = useCallback(
    async (col, values) => {
      const dashboard = embedRef.current;
      if (!dashboard || !sheetIdRef.current || !readyRef.current) {
        pendingRef.current.push({ col, values });
        return;
      }

      const known = knownFilterGroupsRef.current;
      const existed = Object.prototype.hasOwnProperty.call(known, col);
      const isNative = Boolean(nativeFilterGroupIdRef.current[col]);

      try {
        if (!values.length) {
          if (existed) {
            if (isNative) {
              await dashboard.updateFilterGroups([
                buildCategoryFilterGroup(col, known[col] || [], 'DISABLED'),
              ]);
              known[col] = [];
            } else {
              await dashboard.removeFilterGroups([filterGroupIdFor(col)]);
              delete known[col];
            }
          }
        } else {
          const group = buildCategoryFilterGroup(col, values, 'ENABLED');
          if (existed) {
            console.log(`[filter-groups] updateFilterGroups payload for "${col}":`, group);
            await dashboard.updateFilterGroups([group]);
          } else {
            console.log(`[filter-groups] addFilterGroups payload for "${col}":`, group);
            await dashboard.addFilterGroups([group]);
          }
          known[col] = [...values];
        }
      } catch (e) {
        const reason = typeof e === 'string' ? e : e?.message || e;
        console.error(`[filter-groups] applyColumnFilter failed for "${col}":`, reason, e);
        console.error(`[filter-groups] sheetId at failure time was:`, sheetIdRef.current);
        // Commonly caused by a stray unparseable native FilterGroup elsewhere on the
        // sheet failing the SDK's whole-sheet validation. Re-queue so it gets retried
        // automatically once the unhandledrejection handler below removes the culprit.
        pendingRef.current.push({ col, values });
        return;
      }
      setColumnFilter(col, values, col);
    },
    [embedRef, buildCategoryFilterGroup, filterGroupIdFor, setColumnFilter]
  );

  const flushPendingUpdates = useCallback(async () => {
    if (!pendingRef.current.length) return;
    const queued = pendingRef.current.splice(0, pendingRef.current.length);
    for (const { col, values } of queued) {
      await applyColumnFilter(col, values);
    }
  }, [applyColumnFilter]);

  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      if (!isFilterGroupTranslationNoise(event.reason)) return;
      event.preventDefault();

      const dashboard = embedRef.current;
      const brokenId = extractBrokenFilterGroupId(event.reason);

      if (!brokenId || autoHealedIdsRef.current.has(brokenId) || !dashboard) {
        console.warn(
          '[filter-groups] suppressed a known SDK limitation: this sheet has a native ' +
            'FilterGroup the embedding SDK cannot parse (commonly a reader-added ' +
            '"exploration" filter left scoped to no visuals). Discovery/cleanup/polling ' +
            'will keep retrying on schedule, but the actual fix is removing that stray ' +
            'FilterGroup from the dashboard or analysis in QuickSight.'
        );
        return;
      }

      autoHealedIdsRef.current.add(brokenId);
      console.warn(
        `[filter-groups] auto-removing unparseable native FilterGroup "${brokenId}" -- ` +
          'it has no valid visual ids and was failing whole-sheet validation for every ' +
          'addFilterGroups/updateFilterGroups call. Retrying pending updates after removal.'
      );
      dashboard
        .removeFilterGroups([brokenId])
        .then(() => Promise.all([discoverNativeFilterGroups(), cleanupStaleFilterGroups()]))
        .then(() => flushPendingUpdates())
        .then(() => {
          console.warn(`[filter-groups] auto-heal complete for "${brokenId}"; sync should resume.`);
        })
        .catch((err) => {
          console.error(
            `[filter-groups] auto-removal of broken FilterGroup "${brokenId}" failed:`,
            err?.message || err
          );
        });
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, [embedRef, discoverNativeFilterGroups, cleanupStaleFilterGroups, flushPendingUpdates]);

  const clearAllKnownFilterGroups = useCallback(async () => {
    const dashboard = embedRef.current;
    const known = knownFilterGroupsRef.current;
    const cols = Object.keys(known);
    if (!dashboard || !cols.length) return;
    const nativeCols = cols.filter((c) => nativeFilterGroupIdRef.current[c]);
    const ownCols = cols.filter((c) => !nativeFilterGroupIdRef.current[c]);
    try {
      if (ownCols.length) {
        await dashboard.removeFilterGroups(ownCols.map(filterGroupIdFor));
        ownCols.forEach((c) => delete known[c]);
      }
      if (nativeCols.length) {
        const groups = nativeCols.map((c) => buildCategoryFilterGroup(c, [], 'DISABLED'));
        await dashboard.updateFilterGroups(groups);
        nativeCols.forEach((c) => {
          known[c] = [];
        });
      }
    } catch (e) {
      console.error('[filter-groups] clearAllKnownFilterGroups failed:', e.message);
    }
    cols.forEach((c) => clearColumn(c));
  }, [embedRef, buildCategoryFilterGroup, filterGroupIdFor, clearColumn]);

  const pollFilterGroupColumns = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard || !sheetIdRef.current || !filterGroupColumns.size) return;
    try {
      const groups = await getFilterGroupsForSheetSafe(dashboard, sheetIdRef.current);
      const byCol = {};
      (groups || []).forEach((g) => {
        filterGroupColumns.forEach((col) => {
          if (g.FilterGroupId !== filterGroupIdFor(col)) return;
          const cf = g.Filters?.[0]?.CategoryFilter;
          const vals =
            g.Status !== 'DISABLED' && cf?.Configuration?.FilterListConfiguration
              ? cf.Configuration.FilterListConfiguration.CategoryValues || []
              : [];
          byCol[col] = vals.map(String);
        });
      });
      filterGroupColumns.forEach((col) => {
        const current = byCol[col] || [];
        const known = knownFilterGroupsRef.current[col] || [];
        const changed =
          current.length !== known.length ||
          [...current].sort().some((v, i) => v !== [...known].sort()[i]);
        if (!changed) return;
        console.log('[filter-groups] change detected for', col, ':', current);
        if (current.length) {
          knownFilterGroupsRef.current[col] = current;
        } else if (nativeFilterGroupIdRef.current[col]) {
          knownFilterGroupsRef.current[col] = [];
        } else {
          delete knownFilterGroupsRef.current[col];
        }
        setColumnFilter(col, current, col);
      });
    } catch (e) {
    }
  }, [embedRef, filterGroupColumns, filterGroupIdFor, setColumnFilter]);

  useEffect(() => {
    if (!dashboardReady || !filterGroupColumns.size) return undefined;
    let cancelled = false;
    let pollIntervalId = null;

    (async () => {
      sheetIdRef.current = await resolveSheetId();
      if (!sheetIdRef.current) {
        console.error('[filter-groups] could not resolve a sheet id -- FilterGroups calls will fail');
      }
      await discoverNativeFilterGroups();
      await cleanupStaleFilterGroups();
      if (cancelled) return;
      readyRef.current = true;
      await flushPendingUpdates();
      pollIntervalId = setInterval(async () => {
        if (pollBusyRef.current) return;
        pollBusyRef.current = true;
        try {
          await flushPendingUpdates();
          await pollFilterGroupColumns();
        } finally {
          pollBusyRef.current = false;
        }
      }, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      if (pollIntervalId) clearInterval(pollIntervalId);
    };
  }, [dashboardReady, filterGroupColumns.size]);

  return { applyColumnFilter, clearAllKnownFilterGroups };
}
