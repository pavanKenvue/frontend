import { useRef, useState } from 'react';
import { FilterProvider } from './context/FilterContext';
import { useQuickSightBridge } from './hooks/useQuickSightBridge';
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

  // Sidebar toggling squeezes/frees the dashboard's width — .sidebar's own
  // CSS transition (App.css) takes 250ms, and QuickSight needs a bit longer
  // than that to finish redrawing to fit. A brief veil over the dashboard
  // for that whole window (see dashboard-resize-veil in App.css) hides the
  // squish-then-snap instead of showing it.
  const toggleSidebar = () => {
    setSidebarCollapsed((c) => !c);
    setDashboardResizing(true);
    clearTimeout(resizeVeilTimerRef.current);
    resizeVeilTimerRef.current = setTimeout(() => setDashboardResizing(false), 450);
  };
  const { appliedFilters, paramForColumn } = useFilters();

  const { sendToQuickSight, resetAll, resetAndApply, handleParametersChanged } =
    useQuickSightBridge(embedRef);

  // ── Auto-restore a shared bookmark link (?bm=<id>) on first load ──
  // Mirrors the vanilla index_v6.js behaviour: opening index.html?bm=<id>
  // fresh should apply that bookmark's filters to the dashboard, not just
  // show them in the Filter Builder. Read the id once at mount (a bookmark
  // link is only ever meant to apply on the initial page load, not on every
  // re-render), then fire it once the dashboard embed reports itself ready
  // (see the onLoad handler passed to DashboardEmbed below) — applying any
  // earlier would call setParameters() before embedRef.current exists.
  const bmIdRef = useRef(new URLSearchParams(window.location.search).get('bm'));
  const bmAppliedRef = useRef(false);
  const { open: openBookmark } = useBookmarks({ onApplied: (paramValues) => resetAndApply(paramValues) });

  // FilterBuilder -> QuickSight
  const handleFilterApplied = (paramName, values) => {
    sendToQuickSight(paramName, values);
  };

  const handleResetAll = () => {
    resetAll();
  };

  const handleClearRow = (clearedCol) => {
    // Re-push whatever filters remain after removing this column's row,
    // mirroring sendResetAndApply() in the vanilla JS. `appliedFilters` here
    // can still be one render behind clearColumn(clearedCol) — React hasn't
    // re-rendered yet at this point in the event handler — so exclude the
    // cleared column explicitly rather than trusting it's already gone.
    const remaining = {};
    Object.entries(appliedFilters).forEach(([col, f]) => {
      if (col === clearedCol) return;
      remaining[f.paramName || paramForColumn(col)] = f.values;
    });
    resetAndApply(remaining);
  };

  // QuickSight -> FilterBuilder (native Controls changed).
  // Receives the full changedParameters batch; the bridge decides which of
  // them are Controls parameters worth syncing.
  const handleParameterChange = (changedParameters, eventName) => {
    handleParametersChanged(changedParameters, eventName);
  };

  const handleExportPdf = async () => {
    if (!embedRef.current?.isReady()) {
      console.warn('[export] dashboard not ready, dropping export request');
      return;
    }
    try {
      // Opens the browser's print dialog with the dashboard's own rendered
      // output (current filters included) — choose "Save as PDF" as the
      // destination. A client-side screenshot can't reach into the
      // cross-origin QuickSight iframe, so this SDK call is the only way to
      // get the real charts into a PDF.
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
    // Small extra delay so the embed's own postMessage channel has settled
    // before the first setParameters() call — same reasoning as the 500ms
    // buffer after FRAME_LOADED in the vanilla index_v6.js implementation.
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
        onApplied={(paramValues) => resetAndApply(paramValues)}
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
