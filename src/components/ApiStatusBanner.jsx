import { useEffect, useState } from 'react';
import { getHealth } from '../api/filters';

/**
 * Surfaces backend problems that would otherwise look like a broken UI.
 *
 * The three worth showing: the API is unreachable, Oracle is down, or the
 * facet layer has not been built (which means every cascade falls back to a
 * full scan of the fact table and will feel slow).
 */
export default function ApiStatusBanner() {
  const [issue, setIssue] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    getHealth(controller.signal)
      .then((h) => {
        if (cancelled) return;
        if (h?.database !== 'reachable') {
          setIssue({
            level: 'error',
            text: 'The API cannot reach the database. Filter values will not load.',
          });
        } else if (h?.facetLayer && !h.facetLayer.facetTable) {
          setIssue({
            level: 'warn',
            text:
              'Facet layer not built — filtering falls back to a full table scan and may be slow. '
              + 'Apply sql/01_facets.sql and sql/02_value_dict.sql.',
          });
        }
      })
      .catch((e) => {
        if (cancelled || e.name === 'AbortError') return;
        setIssue({ level: 'error', text: e.message });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (!issue) return null;
  return <div className={`api-banner api-banner-${issue.level}`}>{issue.text}</div>;
}
