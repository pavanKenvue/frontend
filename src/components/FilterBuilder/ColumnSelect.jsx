import { memo, useMemo, useRef, useState } from 'react';

function ColumnSelect({ columns, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => c.toLowerCase().includes(q));
  }, [columns, query]);

  const pick = (col) => {
    onChange(col);
    setQuery('');
    setOpen(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (wrapRef.current?.matches(':hover')) return;
      if (document.activeElement === inputRef.current) return;
      setOpen(false);
      setQuery('');
    }, 150);
  };

  return (
    <div className="fb-col-select-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        className="fb-input fb-col-select-input"
        placeholder={disabled ? 'Loading columns...' : 'Search for columns'}
        autoComplete="off"
        disabled={disabled}
        value={open ? query : value || ''}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            inputRef.current?.blur();
          }
        }}
        onBlur={handleBlur}
      />
      {value && !open && (
        <button
          type="button"
          className="fb-col-select-clear"
          title="Clear column"
          onClick={() => onChange('')}
        >
          ✕
        </button>
      )}

      {open && (
        <div className="fb-search-dropdown fb-col-select-dropdown">
          <div className="fb-search-results">
            {!filtered.length && (
              <div className="fb-search-no-results">
                No columns match "<strong>{query}</strong>"
              </div>
            )}
            {filtered.map((col) => (
              <div
                key={col}
                className={`fb-search-result-item${col === value ? ' selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(col)}
              >
                <span>{col}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ColumnSelect);
