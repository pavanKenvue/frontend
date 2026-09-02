import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createEmbeddingContext } from 'amazon-quicksight-embedding-sdk';

import { getEmbedUrl as fetchEmbedUrl } from '../api/filters';
import previewGif from '../assets/preview.gif';
async function getEmbedUrl(signal) {
  const data = await fetchEmbedUrl(signal);
  if (!data?.embedUrl) throw new Error('Backend did not return an embedUrl');
  return data.embedUrl;
}

const DashboardEmbed = forwardRef(function DashboardEmbed(
  { onParameterChange, onLoad, onError, resizing },
  ref
) {
  const containerRef = useRef(null);
  const dashboardRef = useRef(null);
  // Snapshot of the dashboard's own Controls, captured while seeding below —
  // i.e. the true authored defaults, from before any user filtering could
  // have touched them. Clear All reuses this instead of asking QuickSight to
  // report its post-reset state fresh each time (see resetAll() in
  // useQuickSightBridge.js for why that's unreliable, especially on a
  // second reset in a row).
  const defaultParamsRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const onParameterChangeRef = useRef(onParameterChange);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onParameterChangeRef.current = onParameterChange;
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  });
  useImperativeHandle(ref, () => ({
    setParameters: (params) => dashboardRef.current?.setParameters(params),
    reset: () => dashboardRef.current?.reset(),
    isReady: () => Boolean(dashboardRef.current),
    // Triggers QuickSight's own print flow for the dashboard as it's
    // currently filtered. The dashboard lives in a cross-origin iframe (an
    // AWS-hosted URL), so a client-side screenshot library (html2canvas)
    // can't read its content — this SDK method is the only way to get the
    // real rendered visuals into a PDF (via the browser's print-to-PDF).
    initiatePrint: () => dashboardRef.current?.initiatePrint(),
    getParameters: () => dashboardRef.current?.getParameters(),
    // The captured true-default snapshot (see defaultParamsRef above) —
    // null until seeding has caught at least one non-empty parameter set.
    getDefaultParameters: () => defaultParamsRef.current,
  }));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // getEmbedUrl() (a backend round-trip) and createEmbeddingContext()
        // (the SDK's own internal setup) don't depend on each other — only
        // embedDashboard() below needs both. Running them concurrently
        // instead of one after the other shaves the smaller of the two
        // durations off the critical path before the iframe can even be
        // created.
        const [embedUrl, embeddingContext] = await Promise.all([
          getEmbedUrl(),
          createEmbeddingContext(),
        ]);
        if (cancelled) return;
        const seedInitialParameters = async () => {
          const delaysMs = [0, 1500, 3000, 5000];
          for (const delay of delaysMs) {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            if (cancelled) return;
            try {
              const params = await dashboardRef.current?.getParameters();
              if (cancelled) return;
              if (params?.length) {
                defaultParamsRef.current = params;
                onParameterChangeRef.current?.(params, 'PARAMETERS_CHANGED');
              }
            } catch (e) {
              console.error('[dashboard] getParameters failed:', e);
            }
          }
        };

        const frameOptions = {
          url: embedUrl,
          container: containerRef.current,
          height: '100%',
          width: '100%',
          onChange: (changeEvent) => {
            if (changeEvent.eventName === 'FRAME_LOADED') {
              setStatus('ready');
              onLoadRef.current?.();
              seedInitialParameters();
            }
          },
        };

        const contentOptions = {
          parameters: [],
          locale: 'en-US',
          // Without this, the dashboard keeps the fixed pixel width/layout
          // it was authored at and only catches up to a container resize
          // (e.g. toggling the Filter Builder sidebar) via QuickSight's own
          // internal, debounced resize detection — which is what made
          // resizing feel late. fitSheetToWidth makes it track the iframe's
          // actual width continuously instead.
          sheetOptions: {
            fitSheetToWidth: true,
          },
          onMessage: async (messageEvent) => {
            if (messageEvent.eventName === 'PARAMETERS_CHANGED') {
              const changed = messageEvent.message?.changedParameters || [];
              console.debug('[dashboard] PARAMETERS_CHANGED', JSON.stringify(changed));
              if (changed.length) {
                onParameterChangeRef.current?.(changed, messageEvent.eventName);
              }
              return;
            }
            if (messageEvent.eventName === 'ERROR_OCCURRED') {
              setStatus('error');
              setErrorMsg(JSON.stringify(messageEvent.message));
              onErrorRef.current?.(messageEvent.message);
            }
          },
        };

        const dashboard = await embeddingContext.embedDashboard(frameOptions, contentOptions);
        dashboardRef.current = dashboard;
      } catch (e) {
        if (cancelled) return;
        console.error('[DashboardEmbed] failed to embed dashboard:', e);
        setStatus('error');
        setErrorMsg(
          e.type === 'ConfigError'
            ? 'QuickSight is not configured on the backend. Set AWS_ACCOUNT_ID, '
              + 'DASHBOARD_ID and QUICKSIGHT_USER_ARN, then restart the API.'
            : e.message || 'Failed to load dashboard'
        );
        onError?.(e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dashboard-wrap">
      {status === 'loading' && (
        <div id="loading">
          <img src={previewGif} alt="" className="loading-gif" />
          <p>Loading dashboard...</p>
        </div>
      )}
      {status === 'error' && (
        <div className="error-box show">
          <div className="error-card">
            <h3>Failed to load dashboard</h3>
            <pre>{errorMsg}</pre>
          </div>
        </div>
      )}
      <div id="dashboard-container" ref={containerRef} />
      {/* Brief veil while the sidebar's own width transition is running —
          masks the moment where the iframe has resized but QuickSight
          hasn't finished redrawing to fit yet, instead of showing that
          squish-then-snap directly. */}
      {resizing && <div className="dashboard-resize-veil" />}
    </div>
  );
});

export default DashboardEmbed;
