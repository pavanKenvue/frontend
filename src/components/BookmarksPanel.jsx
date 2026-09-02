import { useEffect, useRef, useState } from 'react';
import { useBookmarks } from '../hooks/useBookmarks';
import { useFilters } from '../context/FilterContext';
import { bookmarkUrlFor } from '../utils/bookmarkUrl';

const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  link: 'M9 17H7a5 5 0 1 1 0-10h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.3-4.3',
  chevron: 'm6 9 6 6 6-6',
  bookmark: 'M6 3a1 1 0 0 0-1 1v17l7-4 7 4V4a1 1 0 0 0-1-1H6Z',
  external: 'M14 4h6m0 0v6m0-6L10 14M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m-9 0 1 14a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-14',
  check: 'M20 6 9 17l-5-5',
};

function Icon({ name, size = 16, className }) {
  if (name === 'more') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
        <circle cx="12" cy="5" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function fmtBmDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-GB', { month: 'short' });
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${d.getFullYear()}, ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

const BOOKMARKS_PAGE_SIZE = 10;

function summarizeValues(values, max = 2) {
  if (!values?.length) return '';
  const shown = values.slice(0, max).join(', ');
  return values.length > max ? `${shown} +${values.length - max}` : shown;
}

async function buildBookmarkPdf(bmName, createdAt, url, filters) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 48;
  const pageBottom = 780;
  const pageWidth = 545;
  let y = 60;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(24, 24, 24);
  doc.text(bmName || 'Untitled bookmark', marginX, y);
  y += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text(`Saved: ${createdAt ? new Date(createdAt).toLocaleString() : ''}`, marginX, y);
  y += 24;

  doc.setTextColor(0, 135, 122);
  doc.textWithLink('Open this dashboard with these filters applied →', marginX, y, { url });
  y += 30;

  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, y, pageWidth, y);
  y += 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(24, 24, 24);
  doc.text('Filters', marginX, y);
  y += 20;

  doc.setFontSize(11);
  const rows = Object.entries(filters || {}).filter(([, f]) => f?.values?.length);
  if (!rows.length) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(136, 136, 136);
    doc.text('No filter details available.', marginX, y);
  } else {
    rows.forEach(([label, { values }]) => {
      const wrapped = doc.splitTextToSize(values.join(', '), pageWidth - marginX - 140);
      const rowHeight = 15 * Math.max(1, wrapped.length) + 8;
      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = 60;
      }
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(24, 24, 24);
      doc.text(`${label}:`, marginX, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(wrapped, marginX + 130, y);
      y += rowHeight;
    });
  }

  const safeName = (bmName || 'bookmark').replace(/[^\w\- ]+/g, '_').trim() || 'bookmark';
  doc.save(`${safeName}.pdf`);
}

export default function BookmarksPanel({ open, onClose, onApplied }) {
  const { appliedFilters } = useFilters();
  const {
    bookmarks,
    loading,
    error,
    refresh,
    save,
    open: openBookmark,
    rename,
    remove,
    getFilters,
  } = useBookmarks({ onApplied });

  // 'list' mirrors the default My Bookmarks view; '+ Add' switches to 'save'.
  const [view, setView] = useState('list');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // { id, name, url }
  const [expandedId, setExpandedId] = useState(null);
  const [detailById, setDetailById] = useState({});
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openLinkId, setOpenLinkId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const renameInputRef = useRef(null);
  const skipNextRenameBlurRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    refresh();
    setView('list');
    setSaveResult(null);
    setName('');
    setQuery('');
  }, [open, refresh]);

  // Back to page 1 whenever the search narrows/widens the list or the
  // underlying bookmark count changes (save/delete/refresh) — the current
  // page number otherwise has no guaranteed relationship to the new list.
  useEffect(() => {
    setPage(1);
  }, [query, bookmarks.length]);

  // Close any open row "⋮" menu on an outside click.
  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = () => setOpenMenuId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openMenuId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  if (!open) return null;

  const appliedEntries = Object.entries(appliedFilters).filter(([, f]) => f?.values?.length);
  const filteredBookmarks = query.trim()
    ? bookmarks.filter((b) => (b.name || '').toLowerCase().includes(query.trim().toLowerCase()))
    : bookmarks;
  const totalPages = Math.max(1, Math.ceil(filteredBookmarks.length / BOOKMARKS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedBookmarks = filteredBookmarks.slice(
    (currentPage - 1) * BOOKMARKS_PAGE_SIZE,
    currentPage * BOOKMARKS_PAGE_SIZE
  );

  const guard = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error('[bookmarks] action failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const toggleDetail = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!detailById[id]) {
      try {
        const filters = await getFilters(id);
        setDetailById((prev) => ({ ...prev, [id]: filters }));
      } catch (e) {
        console.error('[bookmarks] failed to load detail:', e);
      }
    }
  };

  const copyLink = async (id) => {
    const url = bookmarkUrlFor(id);
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      console.error('[bookmarks] clipboard write failed:', e);
    }
  };

  const saveLocally = async (id, bmName, createdAt) => {
    await guard(async () => {
      const filters = await getFilters(id);
      await buildBookmarkPdf(bmName, createdAt, bookmarkUrlFor(id), filters);
    });
  };

  const goToList = () => {
    setView('list');
    setName('');
    setSaveResult(null);
  };

  const goToSave = () => {
    setView('save');
    setSaveResult(null);
  };

  const doSave = async () => {
    if (!name.trim() || !appliedEntries.length) return;
    setBusy(true);
    try {
      const created = await save(name);
      setSaveResult({ id: created.id, name: created.name, url: bookmarkUrlFor(created.id) });
    } catch (e) {
      console.error('[bookmarks] save failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const toggleMenu = (e, id) => {
    e.stopPropagation();
    setOpenMenuId((cur) => (cur === id ? null : id));
  };

  const toggleLinkBox = (e, id) => {
    e.stopPropagation();
    setOpenLinkId((cur) => (cur === id ? null : id));
  };

  const doOpen = (id) => {
    setOpenMenuId(null);
    guard(() => openBookmark(id)).then(() => {
      setTimeout(onClose, 900);
    });
  };

  const startRename = (id, currentName) => {
    setOpenMenuId(null);
    setRenamingId(id);
    setRenameValue(currentName || '');
  };

  const commitRename = (id, originalName) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === originalName) return;
    guard(() => rename(id, trimmed));
  };

  const doDelete = async (id) => {
    setOpenMenuId(null);
    setDeletingId(id);
    try {
      await guard(() => remove(id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bm-side-panel" role="dialog" aria-label="Bookmarks">
      <div className="bm-panel-header">
        <div>
          <div className="bm-panel-title">Bookmarks</div>
          <div className="bm-panel-subtitle">
            {bookmarks.length ? `${bookmarks.length} saved` : 'Saved filter sets'}
          </div>
        </div>
        <button className="bm-panel-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="bm-panel-body">
        {view === 'save' ? (
          <div className="bm-panel-scroll">
            <button className="bm-back-btn" onClick={goToList}>
              <Icon name="chevron" size={14} className="bm-back-chevron" /> Back to list
            </button>
            {!saveResult && (
              <>
                <label className="bm-label" htmlFor="bm-name-input">
                  Bookmark name
                </label>
                <input
                  id="bm-name-input"
                  className="bm-input"
                  placeholder="e.g. Q3 Doctor review"
                  maxLength={120}
                  autoComplete="off"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim() && appliedEntries.length) {
                      doSave();
                    }
                  }}
                />
              </>
            )}
            <label className="bm-label">Filters being saved</label>
            {appliedEntries.length ? (
              <div className="bm-chip-list">
                {appliedEntries.map(([label, f]) => (
                  <span className="bm-chip" key={label}>
                    <span className="bm-chip-label">{label}</span>
                    <span className="bm-chip-value">{summarizeValues(f.values)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="bm-empty-state bm-empty-state-inline">
                <Icon name="bookmark" size={22} className="bm-empty-icon" />
                <div className="bm-empty-sub">Apply at least one filter to bookmark this view.</div>
              </div>
            )}
            <button
              className="bm-save-btn"
              disabled={busy || !name.trim() || !appliedEntries.length || Boolean(saveResult)}
              onClick={doSave}
            >
              {busy ? (
                <>
                  <span className="bm-btn-spinner" aria-hidden="true" /> Saving…
                </>
              ) : saveResult ? (
                <>
                  <Icon name="check" size={15} /> Saved
                </>
              ) : (
                'Save bookmark'
              )}
            </button>
            {saveResult && (
              <div className="bm-save-result">
                <label className="bm-label">Shareable link</label>
                <input
                  type="text"
                  className="bm-input"
                  value={saveResult.url}
                  readOnly
                  onClick={(e) => e.target.select()}
                />
                <div className="bm-save-result-actions">
                  <button className="bm-save-btn bm-save-btn-secondary" onClick={() => copyLink(saveResult.id)}>
                    <Icon name="link" size={14} /> Copy link
                  </button>
                  <button
                    className="bm-save-btn bm-save-btn-secondary"
                    onClick={() => saveLocally(saveResult.id, saveResult.name)}
                  >
                    <Icon name="download" size={14} /> Save locally
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="bm-panel-fixed">
              <button className="bm-add-btn" onClick={goToSave}>
                <Icon name="plus" size={16} /> Add bookmark
              </button>

              {bookmarks.length > 0 && (
                <div className="bm-search">
                  <Icon name="search" size={14} className="bm-search-icon" />
                  <input
                    type="text"
                    className="bm-search-input"
                    placeholder="Search bookmarks…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="bm-panel-list">
            {loading && !bookmarks.length && (
              <div className="bm-skeleton-list" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div className="bm-skeleton-row" key={i}>
                    <div className="bm-skeleton-line bm-skeleton-line-title" />
                    <div className="bm-skeleton-line bm-skeleton-line-sub" />
                  </div>
                ))}
              </div>
            )}
            {error && (
              <div className="bm-empty-state bm-empty-state-inline">
                <Icon name="bookmark" size={22} className="bm-empty-icon" />
                <div className="bm-empty-sub">No saved bookmarks found.</div>
              </div>
            )}

            {!loading && !error && !bookmarks.length && (
              <div className="bm-empty-state">
                <Icon name="bookmark" size={28} className="bm-empty-icon" />
                <div className="bm-empty-title">No bookmarks yet</div>
                <div className="bm-empty-sub">
                  Apply some filters, then save them here to quickly come back to this view.
                </div>
              </div>
            )}
            {!loading && !error && bookmarks.length > 0 && !filteredBookmarks.length && (
              <div className="bm-empty-state">
                <div className="bm-empty-sub">No bookmarks match "{query}".</div>
              </div>
            )}

            {pagedBookmarks.map((b) => {
              const isExpanded = expandedId === b.id;
              const isRenaming = renamingId === b.id;
              const isDeleting = deletingId === b.id;
              const detail = detailById[b.id];
              const detailRows = detail
                ? Object.entries(detail).filter(([, f]) => f?.values?.length)
                : [];
              return (
                <div className={`bm-row${isDeleting ? ' bm-row-deleting' : ''}`} key={b.id}>
                  <div className="bm-row-top">
                    <div
                      className="bm-row-main"
                      onClick={() => !isRenaming && !isDeleting && toggleDetail(b.id)}
                    >
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="bm-rename-input"
                          value={renameValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            // Both keys already resolve the rename here —
                            // the input unmounts right after (isRenaming
                            // flips false), which fires a blur on its way
                            // out. Without this flag that blur would call
                            // commitRename a second time (double-committing
                            // on Enter) or re-commit stale text after an
                            // Escape-cancel.
                            if (e.key === 'Enter') {
                              skipNextRenameBlurRef.current = true;
                              commitRename(b.id, b.name);
                            }
                            if (e.key === 'Escape') {
                              // Stop this from also bubbling up to the
                              // panel-level Escape listener, which would
                              // close the whole panel instead of just
                              // cancelling the rename.
                              e.stopPropagation();
                              skipNextRenameBlurRef.current = true;
                              setRenamingId(null);
                            }
                          }}
                          onBlur={() => {
                            if (skipNextRenameBlurRef.current) {
                              skipNextRenameBlurRef.current = false;
                              return;
                            }
                            commitRename(b.id, b.name);
                          }}
                        />
                      ) : (
                        <div className="bm-row-name-line">
                          <div className="bm-row-name">{b.name || 'Untitled bookmark'}</div>
                          <span className="bm-row-date-badge">{fmtBmDate(b.createdAt)}</span>
                        </div>
                      )}
                    </div>
                    <div className="bm-row-actions">
                      {isDeleting ? (
                        <span className="bm-row-deleting-indicator">
                          <span className="bm-row-spinner" aria-hidden="true" />
                          Deleting…
                        </span>
                      ) : (
                        <>
                          <button
                            className="bm-icon-btn"
                            title="Show/copy link"
                            onClick={(e) => toggleLinkBox(e, b.id)}
                          >
                            <Icon name="link" size={15} />
                          </button>
                          <div className="bm-row-menu-wrap">
                            <button
                              className="bm-icon-btn"
                              title="More actions"
                              onClick={(e) => toggleMenu(e, b.id)}
                            >
                              <Icon name="more" size={16} />
                            </button>
                            <div className={`bm-dropdown${openMenuId === b.id ? ' open' : ''}`}>
                              <button disabled={busy} onClick={() => doOpen(b.id)}>
                                <Icon name="external" size={14} /> Open (apply filters)
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  saveLocally(b.id, b.name, b.createdAt);
                                }}
                              >
                                <Icon name="download" size={14} /> Save locally
                              </button>
                              <button disabled={busy} onClick={() => startRename(b.id, b.name)}>
                                <Icon name="pencil" size={14} /> Rename
                              </button>
                              <button
                                className="bm-danger"
                                disabled={busy}
                                onClick={() => doDelete(b.id)}
                              >
                                <Icon name="trash" size={14} /> Delete
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {openLinkId === b.id && (
                    <div className="bm-link-box">
                      <input
                        type="text"
                        className="bm-link-input"
                        value={bookmarkUrlFor(b.id)}
                        readOnly
                        onClick={(e) => e.target.select()}
                      />
                      <button className="bm-copy-btn" onClick={() => copyLink(b.id)}>
                        Copy
                      </button>
                    </div>
                  )}
                  {isExpanded && (
                    <div className="bm-detail">
                      {!detail && <div className="bm-detail-loading">Loading filter details…</div>}
                      {detail && !detailRows.length && (
                        <div className="bm-empty">No filter details found.</div>
                      )}
                      {detailRows.map(([label, f]) => (
                        <div className="bm-detail-row" key={label}>
                          <span className="bm-fname">{label}</span>
                          <span className="bm-fvals">{f.values.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            </div>

            {totalPages > 1 && (
              <div className="bm-pagination">
                <button
                  className="bm-pagination-btn"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹ Prev
                </button>
                <span className="bm-pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="bm-pagination-btn"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
