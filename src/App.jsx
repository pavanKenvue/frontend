import { useRef, useState } from 'react';
import { FilterProvider } from './context/FilterContext';
import { useQuickSightBridge } from './hooks/useQuickSightBridge';
import { useFilterGroups } from './hooks/useFilterGroups';
import { useFilters } from './context/FilterContext';
import { useBookmarks } from './hooks/useBookmarks';
import FilterBuilder from './components/FilterBuilder/FilterBuilder';
import DashboardEmbed from './components/DashboardEmbed';
import BookmarksPanel from './components/BookmarksPanel';
import ApiStatusBanner from './components/ApiStatusBanner';
import './App.css';

function AppInner() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [dashboardResizing, setDashboardResizing] = useState(false);
  const resizeVeilTimerRef = useRef(null);
  const embedRef = useRef(null);

  const toggleSidebar = () => {
    setSidebarCollapsed((c) => !c);
    setDashboardResizing(true);
    clearTimeout(resizeVeilTimerRef.current);
    resizeVeilTimerRef.current = setTimeout(() => setDashboardResizing(false), 450);
  };
  const { appliedFilters, paramForColumn, filterGroupColumns } = useFilters();

  const { sendToQuickSight, resetAll, resetAndApply, handleParametersChanged } =
    useQuickSightBridge(embedRef);
  const { applyColumnFilter, clearAllKnownFilterGroups } = useFilterGroups(embedRef, dashboardReady);

  const bmIdRef = useRef(new URLSearchParams(window.location.search).get('bm'));
  const bmAppliedRef = useRef(false);

  const handleBookmarkApplied = async (paramValues) => {
    const regular = {};
    const groups = {};
    Object.entries(paramValues || {}).forEach(([key, values]) => {
      if (filterGroupColumns.has(key)) {
        groups[key] = values;
      } else {
        regular[key] = values;
      }
    });
    resetAndApply(regular);
    await clearAllKnownFilterGroups();
    Object.entries(groups).forEach(([col, values]) => applyColumnFilter(col, values));
  };

  const { open: openBookmark } = useBookmarks({ onApplied: handleBookmarkApplied });

  const handleFilterApplied = (column, values) => {
    if (filterGroupColumns.has(column)) {
      const isCleared = values.length === 1 && String(values[0]).toLowerCase() === 'all';
      applyColumnFilter(column, isCleared ? [] : values);
      return;
    }
    sendToQuickSight(paramForColumn(column), values);
  };

  const handleResetAll = () => {
    resetAll();
    clearAllKnownFilterGroups();
  };

  const handleClearRow = (clearedCol) => {
    if (filterGroupColumns.has(clearedCol)) {
      applyColumnFilter(clearedCol, []);
      return;
    }
    const remaining = {};
    Object.entries(appliedFilters).forEach(([col, f]) => {
      if (col === clearedCol) return;
      if (filterGroupColumns.has(col)) return;
      remaining[f.paramName || paramForColumn(col)] = f.values;
    });
    resetAndApply(remaining);
  };

  const handleParameterChange = (changedParameters, eventName) => {
    handleParametersChanged(changedParameters, eventName);
  };

  const handleExportPdf = async () => {
    if (!embedRef.current?.isReady()) {
      console.warn('[export] dashboard not ready, dropping export request');
      return;
    }
    try {
      await embedRef.current.initiatePrint();
    } catch (e) {
      console.error('[export] initiatePrint failed:', e);
    }
  };

  const handleDashboardLoaded = () => {
    setDashboardReady(true);
    const bmId = bmIdRef.current;
    if (!bmId || bmAppliedRef.current) return;
    bmAppliedRef.current = true;
    setTimeout(() => {
      openBookmark(bmId).catch((e) => console.error('[bookmark] failed to restore from URL:', e));
    }, 500);
  };

  return (
    <div className="app-root">
      <header className="header">
        <div>
          <h1>{import.meta.env.VITE_APP_TITLE || 'Safety View - COSMOS'}</h1>
        </div>
        <div className="header-actions">
          <button
            className={`btn-reset${sidebarCollapsed ? '' : ' active'}`}
            onClick={toggleSidebar}
            disabled={!dashboardReady}
            title={dashboardReady ? 'Toggle Filter Builder' : 'Waiting for dashboard to load…'}
          >
            🔍 Search
          </button>
          <button className="btn-reset" onClick={handleExportPdf} title="Export dashboard to PDF">
            Export to PDF
          </button>
          <button
            className="btn-reset"
            onClick={() => setBookmarksOpen(true)}
            title="View, open, save, rename, or delete saved bookmarks"
          >
            📑 My Bookmarks
          </button>
          <button className="btn-reset" onClick={handleResetAll}>
            Reset all filters
          </button>
        </div>
      </header>

      <BookmarksPanel
        open={bookmarksOpen}
        onClose={() => setBookmarksOpen(false)}
        onApplied={handleBookmarkApplied}
      />

      <div className="main">
        <button
          className={`toggle-btn${sidebarCollapsed ? ' collapsed' : ''}`}
          onClick={toggleSidebar}
          disabled={!dashboardReady}
          title={dashboardReady ? 'Toggle Filter Builder' : 'Waiting for dashboard to load…'}
        >
          {sidebarCollapsed ? '▶' : '◀'}
        </button>

        <div className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <FilterBuilder
            onFilterApplied={handleFilterApplied}
            onResetAll={handleResetAll}
            onClearRow={handleClearRow}
          />
        </div>

        <DashboardEmbed
          ref={embedRef}
          onParameterChange={handleParameterChange}
          onLoad={handleDashboardLoaded}
          onError={(e) => console.error('[dashboard] error', e)}
          resizing={dashboardResizing}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <FilterProvider>
      <AppInner />
    </FilterProvider>
  );
}
