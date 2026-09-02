import { memo, useRef, useState } from 'react';
import { searchAllColumns } from '../../api/filters';
import { useFilters } from '../../context/FilterContext';

function HighlightedText({ text, query }) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/**
 * Global "Smart Search" across all columns. Ported from
 * triggerSearch()/runSmartSearch()/renderSearchResults() in the vanilla JS.
 *
 * Backed by the not-yet-contracted /search endpoint (see api/filters.js) —
 * wire the real RDS-backed route in there once available.
 *
 * Wrapped in memo(): this owns its own search state (query, results,
 * selections) entirely independently of the rest of FilterBuilder, so
 * without this it re-rendered — recomputing every group's fully-/
 * partially-selected state — on every unrelated keystroke in the values
 * checklist or textarea above. The caller memoizes onApplySelections so this
 * takes effect.
 */
function SmartSearch({ onApplySelections }) {
  const { appliedFilters } = useFilters();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selections, setSelections] = useState({}); // key -> { column, paramName, value }
  // Snapshot of `selections` right after a search resolves (i.e. exactly
  // the matches that were already applied) — compared against the live
  // `selections` to tell "nothing changed" apart from "the user unchecked
  // something that was already applied", which still needs the Apply button
  // to stay visible even though it drops selCount to 0.
  const initialSelectionsRef = useRef({});
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const searchRowRef = useRef(null);
  // Where to float the results dropdown — captured once when a search
  // opens it (see the render-time positioning below), same position:fixed +
  // measured-rect approach AppliedFilters' ValuesPopover uses, so the
  // dropdown overlays on top of the rest of the Filter Builder (including
  // escaping .fb-panel's own overflow:hidden) instead of pushing everything
  // below it down the panel.
  const [anchorRect, setAnchorRect] = useState(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setAnchorRect(searchRowRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
    setLoading(true);
    setError(null);
    setSelections({});
    initialSelectionsRef.current = {};
    try {
      const data = await searchAllColumns({ q });
      const nextResults = data?.results || [];
      setResults(nextResults);
      // Pre-check whichever matches are already applied for their column,
      // so re-running a search a viewer has already filtered on reflects
      // that instead of showing every match unchecked again.
      const preselected = {};
      nextResults.forEach((group) => {
        const appliedValues = appliedFilters[group.column]?.values;
        if (!appliedValues?.length) return;
        const appliedSet = new Set(appliedValues.map(String));
        group.matches.forEach((value) => {
          if (appliedSet.has(String(value))) {
            preselected[keyFor(group.column, group.paramName, value)] = {
              column: group.column,
              paramName: group.paramName,
              value,
            };
          }
        });
      });
      setSelections(preselected);
      initialSelectionsRef.current = preselected;
    } catch (e) {
      setError(e.message || 'Search failed. Try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setOpen(false);
    setResults([]);
    setSelections({});
  };

  const keyFor = (column, paramName, value) => `${column}||${paramName}||${value}`;

  const toggleSelection = (column, paramName, value) => {
    const key = keyFor(column, paramName, value);
    setSelections((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = { column, paramName, value };
      return next;
    });
  };

  const isGroupFullySelected = (group) =>
    group.matches.length > 0 &&
    group.matches.every((value) => selections[keyFor(group.column, group.paramName, value)]);

  const isGroupPartiallySelected = (group) =>
    !isGroupFullySelected(group) &&
    group.matches.some((value) => selections[keyFor(group.column, group.paramName, value)]);

  // Checkbox toggle: checked -> select every match in this group, unchecked -> deselect them all.
  const toggleGroupSelectAll = (group) => {
    const clearing = isGroupFullySelected(group);
    setSelections((prev) => {
      const next = { ...prev };
      group.matches.forEach((value) => {
        const key = keyFor(group.column, group.paramName, value);
        if (clearing) delete next[key];
        else next[key] = { column: group.column, paramName: group.paramName, value };
      });
      return next;
    });
  };

  const isAllResultsSelected = results.length > 0 && results.every(isGroupFullySelected);
  const isSomeResultsSelected =
    !isAllResultsSelected && results.some((group) => isGroupFullySelected(group) || isGroupPartiallySelected(group));

  // Same checked/unchecked toggle as toggleGroupSelectAll, but across every result group.
  const toggleSelectAllResults = () => {
    const clearing = isAllResultsSelected;
    setSelections((prev) => {
      const next = { ...prev };
      results.forEach((group) => {
        group.matches.forEach((value) => {
          const key = keyFor(group.column, group.paramName, value);
          if (clearing) delete next[key];
          else next[key] = { column: group.column, paramName: group.paramName, value };
        });
      });
      return next;
    });
  };

  const selCount = Object.keys(selections).length;
  // True once the checkboxes disagree with what was already applied when
  // this search last ran — covers unchecking a previously-applied match
  // down to zero, not just checking new ones.
  const initialKeys = Object.keys(initialSelectionsRef.current);
  const hasChanges =
    initialKeys.length !== selCount || initialKeys.some((k) => !selections[k]);

  const applySelections = () => {
    if (!hasChanges) return;
    // Every column this search matched, so the caller can drop values the
    // user unchecked — not just add whatever's still checked. Without this
    // scope, unchecking an already-applied match would have nothing telling
    // FilterContext to remove it.
    const matchedByColumn = {};
    results.forEach((group) => {
      matchedByColumn[group.column] = group.matches.map(String);
    });
    onApplySelections(Object.values(selections), matchedByColumn);
    clearSearch();
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (wrapRef.current?.matches(':hover')) return;
      if (document.activeElement === inputRef.current) return;
      setOpen(false);
    }, 150);
  };

  // Fixed to the viewport, not flowed under the search row — anchored via
  // the measured rect from when the dropdown opened. Flips above the input
  // when there isn't room below (e.g. the search sits near the bottom of a
  // short viewport), same as AppliedFilters' ValuesPopover.
  let dropdownStyle = null;
  if (open && anchorRect) {
    const viewportMargin = 8;
    const width = anchorRect.width;
    const left = Math.min(anchorRect.left, window.innerWidth - width - viewportMargin);
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const openUpward = spaceBelow < 260 && anchorRect.top > 260;
    dropdownStyle = openUpward
      ? { left, bottom: window.innerHeight - anchorRect.top + 6, width }
      : { left, top: anchorRect.bottom + 6, width };
  }

  return (
    <div className="fb-search-wrap" ref={wrapRef}>
      <span className="fb-label">Smart Search</span>
      <div className="fb-search-row" ref={searchRowRef}>
        <input
          ref={inputRef}
          type="text"
          className="fb-input"
          placeholder="Enter 3 characters to search..."
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          onBlur={handleBlur}
        />
        <button className="fb-search-btn" onClick={runSearch} disabled={loading}>
          {loading ? <span className="fb-search-btn-spinner" aria-hidden="true" /> : 'Search'}
        </button>
        {query && (
          <button className="fb-search-clear-btn" onClick={clearSearch}>
            ✕
          </button>
        )}
      </div>

      {/* Stays closed for the whole request — the button above carries the
          loading state instead of showing it in here — and only opens once
          results/error are ready. */}
      {dropdownStyle && !loading && (
        <div className="fb-search-dropdown" style={dropdownStyle}>
          <div className="fb-search-results">
            {error && <div className="fb-search-no-results">{error}</div>}
            {!error && !results.length && (
              <div className="fb-search-no-results">
                No matches for "<strong>{query}</strong>"
              </div>
            )}
            {!error &&
              results.map((group, idx) => (
                <div key={group.column}>
                  <div className="fb-search-group-label">
                    <span>
                      {group.column}
                      {group.total > group.matches.length && (
                        <span style={{ fontWeight: 400, opacity: 0.6 }}>
                          {' '}
                          — {group.total} matches
                        </span>
                      )}
                    </span>
                    <label className="fb-search-group-select-all">
                      <input
                        type="checkbox"
                        checked={isGroupFullySelected(group)}
                        ref={(el) => {
                          if (el) el.indeterminate = isGroupPartiallySelected(group);
                        }}
                        onChange={() => toggleGroupSelectAll(group)}
                      />
                      Select all
                    </label>
                  </div>
                  {group.matches.map((val) => {
                    const key = keyFor(group.column, group.paramName, val);
                    return (
                      <label
                        key={key}
                        className={`fb-search-result-item${selections[key] ? ' selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={!!selections[key]}
                          onChange={() => toggleSelection(group.column, group.paramName, val)}
                        />
                        <span>
                          <HighlightedText text={val} query={query} />
                        </span>
                      </label>
                    );
                  })}
                  {idx < results.length - 1 && <hr className="fb-search-divider" />}
                </div>
              ))}
          </div>

          {(selCount > 0 || hasChanges) && (
            <div className="fb-search-apply-bar">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="fb-search-sel-count">
                  {selCount > 0
                    ? `${selCount} value${selCount > 1 ? 's' : ''} selected`
                    : 'All matches deselected'}
                </span>
                <label className="fb-search-select-all-btn">
                  <input
                    type="checkbox"
                    checked={isAllResultsSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomeResultsSelected;
                    }}
                    onChange={toggleSelectAllResults}
                  />
                  Select all
                </label>
              </div>
              <button className="fb-search-apply-all" onClick={applySelections} disabled={!hasChanges}>
                Apply filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(SmartSearch);
