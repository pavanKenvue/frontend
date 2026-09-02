import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useColumns } from '../../hooks/useColumns';
import { useColumnValues } from '../../hooks/useColumnValues';
import { useFilters } from '../../context/FilterContext';
import { parseNumericOp, valueMatchesOp, valuesMatch } from '../../utils/numericOps';
import ValuesList from './ValuesList';
import AppliedFilters from './AppliedFilters';
import SmartSearch from './SmartSearch';
import ColumnSelect from './ColumnSelect';
import './FilterBuilder.css';

/**
 * Resolves typed (comma/newline separated) tokens into filter values.
 * A token matching a known value (case-insensitively) resolves to that
 * value's canonical casing; otherwise it's taken as-is, since the loaded
 * values list is often just a page (or empty, for a not-yet-searched or
 * high-cardinality free-text column like CASE_ID) rather than the full set.
 * Numeric-operator tokens (">50" etc.) still expand against known values —
 * an operator is meaningless without something to match it against.
 */
function sameValues(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.every((v, i) => v === right[i]);
}

function resolveTextInput(rawText, knownValues) {
  const tokens = rawText
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const knownByLower = new Map(knownValues.map((v) => [String(v).toLowerCase(), v]));
  const resolved = new Set();

  tokens.forEach((tok) => {
    // Not gated on isNumericColumn — see the matching note in
    // useColumnValues.js: that flag can still be loading when a token is
    // typed, which would otherwise let "<500" through as a literal filter
    // value instead of being expanded against knownValues.
    const opMatch = parseNumericOp(tok);
    if (opMatch) {
      const matches = knownValues.filter((v) => valueMatchesOp(v, opMatch.op, opMatch.num));
      matches.forEach((v) => resolved.add(String(v)));
      return;
    }

    const canonical = knownByLower.get(tok.toLowerCase());
    resolved.add(canonical !== undefined ? String(canonical) : tok);
  });

  return { values: [...resolved] };
}

export default function FilterBuilder({ onFilterApplied, onResetAll, onClearRow }) {
  const { columns, loading: columnsLoading } = useColumns();
  const {
    appliedFilters,
    paramForColumn,
    setColumnFilter,
    removeFilterValue,
    clearColumn,
    clearAllFilters,
  } = useFilters();

  const [selectedColumn, setSelectedColumn] = useState('');
  const [checkedValues, setCheckedValues] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [status, setStatus] = useState({ msg: '', type: '' });

  const {
    allValues,
    displayedValues,
    hasMore,
    loadMore,
    loadingMore,
    loading: valuesLoading,
    error: valuesError,
    needsSearch,
    searchTerm,
    setSearchTerm,
    searchPending,
    isNumericColumn,
    columnInfo,
  } = useColumnValues(selectedColumn);

  // The values this panel itself last wrote into appliedFilters for the open
  // column. Lets the reconciliation effect below tell "context changed
  // because we pushed it" apart from "context changed because a native
  // QuickSight Control (or bookmark, or search) moved under us".
  const lastPushedValuesRef = useRef([]);

  // Pre-fill checked values + text area with whatever's already applied
  // for this column when it's opened.
  useEffect(() => {
    if (!selectedColumn) {
      setCheckedValues([]);
      setTextInput('');
      lastPushedValuesRef.current = [];
      return;
    }
    const existing = appliedFilters[selectedColumn]?.values || [];
    setCheckedValues(existing);
    setTextInput('');
    setSearchTerm('');
    lastPushedValuesRef.current = existing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColumn]);

  // Keep the open column's checkboxes live against Controls-driven or other
  // external changes to appliedFilters — e.g. a viewer moving the matching
  // native QuickSight Control while this column is open in the panel. Only
  // reconciles when the change didn't originate from this panel's own push
  // (Apply filter / remove value / clear row), so it never fights the user
  // mid-edit.
  useEffect(() => {
    if (!selectedColumn) return;
    const current = appliedFilters[selectedColumn]?.values || [];
    if (sameValues(current, lastPushedValuesRef.current)) return;
    setCheckedValues(current);
    setTextInput('');
    lastPushedValuesRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters, selectedColumn]);

  const { values: resolvedTyped } = useMemo(
    () => resolveTextInput(textInput, allValues),
    [textInput, allValues]
  );

  const totalSelected = useMemo(
    () => new Set([...checkedValues, ...resolvedTyped]).size,
    [checkedValues, resolvedTyped]
  );

  // Drives the "Select all" checkbox's checked/indeterminate state — checked
  // when every value currently in the list is selected, indeterminate when
  // only some are (neither maps to a plain boolean `checked` prop, so the
  // indeterminate half is applied imperatively via selectAllRef below).
  const allDisplayedChecked = useMemo(
    () =>
      displayedValues.length > 0 &&
      displayedValues.every((v) => checkedValues.some((cv) => valuesMatch(cv, v))),
    [displayedValues, checkedValues]
  );
  const someDisplayedChecked = useMemo(
    () =>
      !allDisplayedChecked &&
      displayedValues.some((v) => checkedValues.some((cv) => valuesMatch(cv, v))),
    [displayedValues, checkedValues, allDisplayedChecked]
  );
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someDisplayedChecked;
  }, [someDisplayedChecked]);

  // useCallback: passed to memo()-wrapped ValuesList as onToggleValue — kept
  // referentially stable (uses the functional setState form, no deps) so
  // that memo actually skips re-rendering the checkbox list on unrelated
  // FilterBuilder re-renders (e.g. every keystroke in the textarea below).
  const toggleValue = useCallback((v) => {
    setCheckedValues((prev) => {
      // Remove by numeric-aware match (not just exact string) — a value can
      // already be checked in a different textual form (see valuesMatch),
      // and removing it should clear that existing entry rather than fail
      // to find it and add a mismatched duplicate alongside it.
      const idx = prev.findIndex((x) => valuesMatch(x, v));
      return idx !== -1 ? prev.filter((_, i) => i !== idx) : [...prev, v];
    });
  }, []);

  const toggleSelectAll = () => {
    // Every displayed value is valid now that the list is cascaded server-side,
    // so there is no disabled subset to skip over.
    const selectable = displayedValues.map(String);
    const anyUnchecked = selectable.some((v) => !checkedValues.some((cv) => valuesMatch(cv, v)));
    if (!anyUnchecked) {
      setCheckedValues([]);
      return;
    }
    const toAdd = selectable.filter((v) => !checkedValues.some((cv) => valuesMatch(cv, v)));
    setCheckedValues([...checkedValues, ...toAdd]);
  };

  const handleApply = () => {
    if (!selectedColumn) return;
    // paramMap from /columns arrives param -> column; FilterContext
    // normalizes it, so this resolves correctly either way and falls back to
    // the column name when a column has no explicit parameter.
    const paramName = paramForColumn(selectedColumn);
    if (!paramName) {
      setStatus({ msg: `No parameter for: ${selectedColumn}`, type: 'err' });
      return;
    }
    const values = [...new Set([...checkedValues, ...resolvedTyped])];

    // Unchecking every value (with nothing typed) for a column that already
    // has an applied filter clears it instead of being a no-op — mirrors how
    // removing the last chip in Applied Filters behaves.
    if (!values.length) {
      if (!appliedFilters[selectedColumn]) return;
      lastPushedValuesRef.current = [];
      setColumnFilter(selectedColumn, [], paramName);
      onFilterApplied?.(paramName, ['All']);
      setSelectedColumn('');
      setCheckedValues([]);
      setTextInput('');
      return;
    }

    lastPushedValuesRef.current = values;
    setColumnFilter(selectedColumn, values, paramName);
    onFilterApplied?.(paramName, values);

    setSelectedColumn('');
    setCheckedValues([]);
    setTextInput('');
  };

  const handleClearAll = () => {
    clearAllFilters();
    setSelectedColumn('');
    setCheckedValues([]);
    setTextInput('');
    setStatus({ msg: 'All filters cleared', type: '' });
    onResetAll?.();
  };

  // useCallback: both passed to memo()-wrapped AppliedFilters — see the note
  // on toggleValue above for why that only helps when these stay stable.
  const handleRemoveValue = useCallback(
    (col, value) => {
      removeFilterValue(col, value);
      const paramName = appliedFilters[col]?.paramName || paramForColumn(col);
      const remaining = (appliedFilters[col]?.values || []).filter((v) => String(v) !== value);
      onFilterApplied?.(paramName, remaining.length ? remaining : ['All']);
      if (selectedColumn === col) {
        lastPushedValuesRef.current = remaining;
        setCheckedValues((prev) => prev.filter((v) => v !== value));
      }
    },
    [removeFilterValue, appliedFilters, paramForColumn, onFilterApplied, selectedColumn]
  );

  const handleClearColumnRow = useCallback(
    (col) => {
      const paramName = appliedFilters[col]?.paramName || paramForColumn(col);
      clearColumn(col);
      if (selectedColumn === col) {
        lastPushedValuesRef.current = [];
        setCheckedValues([]);
        setTextInput('');
      }
      onClearRow?.(col, paramName);
    },
    [appliedFilters, paramForColumn, clearColumn, selectedColumn, onClearRow]
  );

  // useCallback: passed to memo()-wrapped SmartSearch as onApplySelections —
  // see the note on toggleValue above for why that only helps when this
  // stays stable.
  //
  // `matchedByColumn` is every value Smart Search showed as an option for
  // each column in its results (checked or not), not just the currently
  // checked ones in `selections`. Without it, this could only ever add
  // values — a match the user unchecked (because it was already applied)
  // would have nothing telling it to actually drop out.
  const handleApplySearchSelections = useCallback(
    (selections, matchedByColumn = {}) => {
      const byColumn = {};
      Object.entries(matchedByColumn).forEach(([col, matchedValues]) => {
        const matchedSet = new Set(matchedValues.map(String));
        const existing = (appliedFilters[col]?.values || []).filter(
          (v) => !matchedSet.has(String(v))
        );
        byColumn[col] = {
          paramName: paramForColumn(col),
          values: new Set(existing),
        };
      });
      selections.forEach(({ column, value }) => {
        if (!byColumn[column]) {
          byColumn[column] = {
            // The normalized map is the single source of truth for parameter
            // names — /search echoes its own paramName, which can disagree.
            paramName: paramForColumn(column),
            values: new Set(appliedFilters[column]?.values || []),
          };
        }
        byColumn[column].values.add(value);
      });
      Object.entries(byColumn).forEach(([col, { paramName, values }]) => {
        const valuesArr = [...values];
        setColumnFilter(col, valuesArr, paramName);
        onFilterApplied?.(paramName, valuesArr.length ? valuesArr : ['All']);
      });
    },
    [paramForColumn, appliedFilters, setColumnFilter, onFilterApplied]
  );

  const appliedCount = Object.keys(appliedFilters).length;

  return (
    <div className="fb-panel">
      <div className="fb-title">
        {/* Filter Builder */}
        {/* {appliedCount > 0 && <span className="fb-applied-badge">{appliedCount}</span>} */}
      </div>
      <SmartSearch onApplySelections={handleApplySearchSelections} />

      <span className="fb-label" style={{ marginTop: 6 }}>
        Column
      </span>
      <ColumnSelect
        columns={columns}
        value={selectedColumn}
        onChange={setSelectedColumn}
        disabled={columnsLoading}
      />

      {selectedColumn && columnInfo && columnInfo.filterable === false && (
        <div className="fb-val-warning">
          {selectedColumn} is a {columnInfo.dataType} column. Free-text columns cannot
          be listed as a value dropdown — type values below instead.
        </div>
      )}

      {selectedColumn && (
        <div className="fb-values-wrap">
          <div className="fb-val-header">
            <span>{selectedColumn}</span>
            <label className="fb-select-all">
              <input
                type="checkbox"
                ref={selectAllRef}
                checked={allDisplayedChecked}
                onChange={toggleSelectAll}
                disabled={!displayedValues.length}
              />
              Select all
            </label>
          </div>
          <input
            type="text"
            className="fb-combined-search"
            placeholder={
              isNumericColumn ? 'Search, or type >, <, =' : 'Search values...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {needsSearch ? (
            <div className="fb-val-empty">
              This column has
              {columnInfo?.numDistinct
                ? ` about ${columnInfo.numDistinct.toLocaleString()} `
                : ' too many '}
              distinct values to list. Type at least 2 characters above to search it.
            </div>
          ) : valuesError ? (
            <div className="fb-val-warning">{valuesError}</div>
          ) : (
            <ValuesList
              values={displayedValues}
              checkedValues={checkedValues}
              onToggleValue={toggleValue}
              loading={valuesLoading || searchPending}
            />
          )}
          {hasMore && (
            <div className="fb-load-more-wrap">
              <button type="button" className="fb-load-more-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          <div className="fb-divider-or">or type values</div>
          <textarea
            className="fb-text-area"
            placeholder="(comma or newline separated)"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
          />
          <div className="fb-text-hint">
            Separate with <strong>commas</strong> or <strong>new lines</strong>
          </div>
          <div className="fb-combined-count">
            {totalSelected > 0 ? `${totalSelected} value${totalSelected > 1 ? 's' : ''} selected` : ''}
          </div>
        </div>
      )}

      <div className="fb-btn-row">
        <button
          className="fb-btn fb-btn-apply"
          onClick={handleApply}
          disabled={totalSelected === 0 && !appliedFilters[selectedColumn]}
        >
          Apply filter
        </button>
        <button className="fb-btn fb-btn-reset" onClick={handleClearAll}>
          Clear all
        </button>
      </div>

      {status.msg && <div className={`fb-status ${status.type}`}>{status.msg}</div>}

      <hr className="fb-hr" />

      <AppliedFilters onRemoveValue={handleRemoveValue} onClearColumn={handleClearColumnRow} />
    </div>
  );
}
