import { useCallback, useRef } from 'react';
import { useFilters } from '../context/FilterContext';

/**
 * Bridges FilterBuilder <-> QuickSight embed.
 *
 * `embedRef` should be a ref holding whatever the QuickSight Embedding SDK
 * gives you back from `embedDashboard(...)` (the object with
 * `.setParameters()` and `.reset()`).
 *
 * Two rules govern the QuickSight -> FilterBuilder direction:
 *
 *  1. Only PARAMETERS_CHANGED is considered. Every other embed event
 *     (visual interactions, drill-downs, selections, size changes, errors)
 *     is dropped at the source in DashboardEmbed.
 *
 *  2. Within PARAMETERS_CHANGED, only parameters that are actually bound to
 *     a Controls filter are accepted. QuickSight sends the *entire* parameter
 *     set on every change — and on first load — including internal parameters
 *     behind calculated fields and filter actions. Without this gate the
 *     Filter Builder fills up with rows the user never touched.
 */
const ALL_TOKENS = new Set(['', 'all', 'select all', '__all__', 'all values']);

function normalizeIncomingValues(values) {
  if (values == null) return [];
  const list = Array.isArray(values) ? values : [values];
  const cleaned = list.filter((v) => v != null).map(String);
  if (!cleaned.length) return [];
  // A control set back to "All" is the absence of a filter, not a filter on
  // the literal string "All".
  if (cleaned.every((v) => ALL_TOKENS.has(v.trim().toLowerCase()))) return [];
  return cleaned;
}

export function useQuickSightBridge(embedRef) {
  const { applyExternalFilters, columnForParam, isControlParam, paramsForColumn, appliedFilters } =
    useFilters();

  // Parameters we pushed ourselves, so their echo can be ignored.
  const recentlySentRef = useRef(new Map());

  // Bumped on every resetAll() call so a still-in-flight round of retries
  // from an earlier click (see resetAll below) can tell it's been
  // superseded by a newer one and stop applying its now-stale results.
  const resetGenerationRef = useRef(0);

  const markSent = useCallback((paramName) => {
    const timers = recentlySentRef.current;
    const existing = timers.get(paramName);
    if (existing) clearTimeout(existing);
    timers.set(
      paramName,
      setTimeout(() => timers.delete(paramName), 800)
    );
  }, []);

  // FilterBuilder -> QuickSight: push a parameter update to the live embed.
  // A column can drive more than one control, so push all of its parameters.
  const sendToQuickSight = useCallback(
    (paramNameOrColumn, values) => {
      const dashboard = embedRef.current;
      if (!dashboard) {
        console.warn('[qs-bridge] dashboard not ready, dropping update:', paramNameOrColumn, values);
        return;
      }
      if (!paramNameOrColumn) return;

      // Accepts either a column name or an already-resolved parameter name.
      const targets = isControlParam(paramNameOrColumn)
        ? [paramNameOrColumn]
        : paramsForColumn(paramNameOrColumn);

      try {
        const params = targets.map((name) => {
          markSent(name);
          return { Name: name, Values: values };
        });
        dashboard.setParameters(params);
      } catch (e) {
        console.error('[qs-bridge] setParameters failed:', e);
      }
    },
    [embedRef, isControlParam, paramsForColumn, markSent]
  );

  /**
   * QuickSight -> FilterBuilder. Receives the whole `changedParameters` array
   * from a single PARAMETERS_CHANGED event and applies it as one state update.
   */
  const handleParametersChanged = useCallback(
    (changedParameters, eventName) => {
      // Unconditional, first thing — so a mis-shapen payload or an early
      // return further down is never a silent no-op. If this line is the
      // only [qs-bridge] output you see, the problem is below; if you don't
      // even see this, handleParametersChanged isn't being called at all.
      console.debug('[qs-bridge] handleParametersChanged received:', eventName, changedParameters);

      if (eventName && eventName !== 'PARAMETERS_CHANGED') return;

      const changed = Array.isArray(changedParameters) ? changedParameters : [];
      if (!changed.length) return;

      const updates = [];
      const ignored = [];
      const skipped = [];

      changed.forEach((p) => {
        try {
          // Defensive: the SDK's documented shape is { Name, Values }, but
          // fall back to lowercase in case a payload ever disagrees with it.
          const paramName = p?.Name ?? p?.name;
          const paramValues = p?.Values ?? p?.values;
          if (!paramName) {
            skipped.push(p);
            return;
          }

          // Rule 2 — not a Controls parameter, not our business.
          if (!isControlParam(paramName)) {
            ignored.push(paramName);
            return;
          }

          // Our own echo coming back.
          if (recentlySentRef.current.has(paramName)) {
            console.debug('[qs-bridge] suppressed own echo:', paramName);
            return;
          }

          const column = columnForParam(paramName);
          if (!column) {
            skipped.push(p);
            return;
          }

          updates.push({
            column,
            paramName,
            values: normalizeIncomingValues(paramValues),
          });
        } catch (e) {
          console.error('[qs-bridge] failed to process parameter, skipping it:', p, e);
        }
      });

      if (skipped.length) {
        console.warn(
          '[qs-bridge] skipped parameters with no usable Name/column (unexpected shape?):',
          skipped
        );
      }
      if (ignored.length) {
        console.debug(
          '[qs-bridge] ignored non-control parameters (not found in /columns paramMap):',
          ignored.join(', ')
        );
      }
      if (updates.length) {
        console.debug('[qs-bridge] applying external updates from QuickSight:', updates);
        applyExternalFilters(updates);
      }
    },
    [applyExternalFilters, columnForParam, isControlParam]
  );

  const resetAll = useCallback(async () => {
    const dashboard = embedRef.current;
    if (!dashboard) return;
    const generation = ++resetGenerationRef.current;

    // Best-effort: also tells QuickSight's own Controls to visually reset.
    // Not awaited/depended on for correctness below — see why in the next
    // comment — so a failure here shouldn't block restoring Applied Filters.
    try {
      dashboard.reset?.();
    } catch (e) {
      console.error('[qs-bridge] dashboard.reset() failed:', e);
    }

    // Prefer the snapshot DashboardEmbed captured right after the
    // dashboard's very first load, before any filtering could have touched
    // it, over asking QuickSight to report its post-reset state fresh.
    // Doing the latter was unreliable — no dependable PARAMETERS_CHANGED
    // event after reset(), and worse on a *second* Clear All in a row,
    // where reset() is close to a no-op on QuickSight's side and its
    // internal state settles even less predictably. The cached snapshot
    // makes this deterministic: same known-good values applied every time,
    // independent of QuickSight's own timing.
    const cachedDefaults = dashboard.getDefaultParameters?.();
    if (cachedDefaults?.length) {
      handleParametersChanged(cachedDefaults, 'PARAMETERS_CHANGED');
      // Re-push them explicitly too, so QuickSight's own Controls end up
      // matching Applied Filters instead of relying on reset() alone.
      try {
        cachedDefaults.forEach((p) => {
          const name = p?.Name ?? p?.name;
          if (name) markSent(name);
        });
        dashboard.setParameters(cachedDefaults);
      } catch (e) {
        console.error('[qs-bridge] re-applying cached defaults failed:', e);
      }
      return;
    }

    // No cached snapshot yet (e.g. Clear All clicked within the first
    // second or two of load, before DashboardEmbed's own seeding caught
    // one) — fall back to polling QuickSight directly for its post-reset
    // state, same shape as that seeding logic.
    const delaysMs = [0, 400, 900, 1600];
    for (const delay of delaysMs) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      // A newer resetAll() call (another click) has superseded this one —
      // let that one own the result instead of this stale round clobbering
      // it.
      if (generation !== resetGenerationRef.current) return;
      try {
        const params = await dashboard.getParameters();
        if (generation !== resetGenerationRef.current) return;
        if (params?.length) {
          handleParametersChanged(params, 'PARAMETERS_CHANGED');
        }
      } catch (e) {
        console.error('[qs-bridge] getParameters after reset failed:', e);
      }
    }
  }, [embedRef, handleParametersChanged, markSent]);

  const resetAndApply = useCallback(
    async (remaining) => {
      const dashboard = embedRef.current;
      if (!dashboard) return;
      try {
        await dashboard.reset();
        const params = [];
        Object.entries(remaining || {}).forEach(([key, values]) => {
          if (!key || key === 'undefined') return;
          const targets = isControlParam(key) ? [key] : paramsForColumn(key);
          targets.forEach((name) => {
            markSent(name);
            params.push({ Name: name, Values: values });
          });
        });
        if (params.length) dashboard.setParameters(params);
      } catch (e) {
        console.error('[qs-bridge] resetAndApply failed:', e);
      }
    },
    [embedRef, isControlParam, paramsForColumn, markSent]
  );

  return {
    sendToQuickSight,
    resetAll,
    resetAndApply,
    handleParametersChanged,
    appliedFilters,
  };
}
