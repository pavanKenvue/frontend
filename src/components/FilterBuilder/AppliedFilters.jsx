import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFilters } from '../../context/FilterContext';

// Chips beyond this many, per column, collapse behind a "+N more" toggle.
const VISIBLE_LIMIT = 2;

// A single value's own text beyond this many characters (e.g. a long
// free-text narrative or a semicolon-joined list) truncates with "…" and
// gets its own "more"/"less" toggle, independent of the column's own
// VISIBLE_LIMIT collapsing above.
const VALUE_TRUNCATE_LENGTH = 25;

// Used by both the inline chip list and the "+N more" popover's chip list
// below, so a long value truncates/expands the same way in either place.
function ChipValue({ value }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length <= VALUE_TRUNCATE_LENGTH) return value;
  return (
    <>
      {expanded ? value : `${value.slice(0, VALUE_TRUNCATE_LENGTH)}…`}
      <button
        type="button"
        className="fb-chip-more-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? 'less' : 'more'}
      </button>
    </>
  );
}

// Values popover for one column's "+N more" — shown as position:fixed
// (anchored via the toggle button's own bounding rect) rather than a plain
// CSS dropdown, because the row it belongs to lives inside
// .fb-applied-list's scrolling container: a normally-positioned dropdown
// would get clipped by that container's overflow instead of floating over
// the whole sidebar.
function ValuesPopover({ col, values, anchorRect, onRemoveValue, onClearColumn, onClose }) {
  const popRef = useRef(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => String(v).toLowerCase().includes(q));
  }, [values, query]);

  // Anchor below the button; flip above if there isn't room beneath it, and
  // clamp horizontally so it never runs off the sidebar's right edge.
  const width = 240;
  const viewportMargin = 8;
  const left = Math.min(anchorRect.left, window.innerWidth - width - viewportMargin);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < 260 && anchorRect.top > 260;
  const style = openUpward
    ? { left, bottom: window.innerHeight - anchorRect.top + 6, width }
    : { left, top: anchorRect.bottom + 6, width };

  return (
    <div className="fb-values-popover" ref={popRef} style={style}>
      <div className="fb-values-popover-head">
        <span>
          {col} <span className="fb-values-popover-count">({values.length})</span>
        </span>
        <button
          className="fb-values-popover-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {values.length > 8 && (
        <input
          type="text"
          className="fb-input fb-values-popover-search"
          placeholder="Search values..."
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      <div className="fb-values-popover-list">
        {!filtered.length && <div className="fb-search-no-results">No values match</div>}
        {filtered.map((v) => {
          const vStr = String(v);
          return (
            <span className="fb-chip" key={vStr}>
              <ChipValue value={vStr} />
              <button
                className="fb-chip-x"
                onClick={() => onRemoveValue(col, vStr)}
                aria-label={`Remove ${vStr}`}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>

      <button
        className="fb-values-popover-clear"
        onClick={() => {
          onClearColumn(col);
          onClose();
        }}
      >
        Clear all {values.length}
      </button>
    </div>
  );
}

// Wrapped in memo(): reads appliedFilters straight from context (so it still
// re-renders whenever that actually changes), but without this it also
// re-rendered on every FilterBuilder-local state change unrelated to it
// (typing in the values search box, the textarea, etc.) since onRemoveValue/
// onClearColumn were previously recreated every render. The caller now
// memoizes those two callbacks so this takes effect.
function AppliedFilters({ onRemoveValue, onClearColumn }) {
  const { appliedFilters } = useFilters();
  const entries = Object.entries(appliedFilters);
  // The one column (if any) whose "+N more" popover is currently open.
  const [openCol, setOpenCol] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);

  const openPopover = (col, e) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setOpenCol(col);
  };
  const closePopover = () => setOpenCol(null);

  // Auto-close if the column's values shrink to the point the popover's own
  // trigger ("+N more") no longer shows in the row — e.g. every remaining
  // value in it was removed one-by-one down to (or below) VISIBLE_LIMIT, or
  // the whole column got cleared.
  useEffect(() => {
    if (!openCol) return;
    const entry = appliedFilters[openCol];
    if (!entry || entry.values.length <= VISIBLE_LIMIT) setOpenCol(null);
  }, [openCol, appliedFilters]);

  return (
    <>
      <div className="fb-applied-header">
        <span className="fb-applied-title">Applied Filters</span>
        <span className="fb-applied-count">{entries.length}</span>
      </div>

      {!entries.length ? (
        <div className="fb-empty-msg">No filters applied yet.</div>
      ) : (
        <div className="fb-applied-list">
          {entries.map(([col, { values }]) => {
            const hiddenCount = values.length - VISIBLE_LIMIT;
            const visibleValues = hiddenCount > 0 ? values.slice(0, VISIBLE_LIMIT) : values;

            return (
              <div key={col} className="fb-applied-row">
                <div className="fb-applied-row-head">
                  <span className="fb-applied-col">{col}</span>
                  <button className="fb-clear-row" onClick={() => onClearColumn(col)}>
                    Clear
                  </button>
                </div>
                <div className="fb-applied-chips">
                  {visibleValues.map((v) => {
                    const vStr = String(v);
                    return (
                      <span className="fb-chip" key={vStr}>
                        <ChipValue value={vStr} />
                        <button
                          className="fb-chip-x"
                          onClick={() => onRemoveValue(col, vStr)}
                          aria-label={`Remove ${vStr}`}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button className="fb-chip-more" onClick={(e) => openPopover(col, e)}>
                      +{hiddenCount} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openCol && (
        <ValuesPopover
          col={openCol}
          values={appliedFilters[openCol]?.values || []}
          anchorRect={anchorRect}
          onRemoveValue={onRemoveValue}
          onClearColumn={onClearColumn}
          onClose={closePopover}
        />
      )}
    </>
  );
}

export default memo(AppliedFilters);
