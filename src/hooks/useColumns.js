import { useEffect, useState } from 'react';
import { describeColumns, getColumns } from '../api/filters';
import { useFilters } from '../context/FilterContext';

export function useColumns() {
  const { loadParamMap, setNumericColumns, setColumnMeta } = useFilters();
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getColumns(controller.signal);
        setColumns(data?.columns || []);
        // The raw response is handed over whole: /columns returns paramMap
        // as { param: column } rather than the documented { column: param },
        // and normalizeParamMap() detects and corrects the orientation using
        // the `columns` array as ground truth.
        loadParamMap(data);

        // Per-column metadata is a separate, optional call: it only has
        // content once column_meta.json has been generated on the backend,
        // and the dropdown must work without it.
        try {
          const described = await describeColumns(controller.signal);
          const byColumn = {};
          const numeric = new Set();
          (described?.columns || []).forEach((c) => {
            byColumn[c.column] = c;
            // /columns never carries a numericColumns field — Oracle's data_type
            // (surfaced here as dataType) is the only source for which columns
            // support the >, <, >=, <=, = operator search.
            if (['NUMBER', 'FLOAT', 'INTEGER', 'BINARY_FLOAT', 'BINARY_DOUBLE'].includes(
              (c.dataType || '').toUpperCase()
            )) {
              numeric.add(c.column);
            }
          });
          setColumnMeta(byColumn);
          setNumericColumns(numeric);
        } catch (metaErr) {
          if (metaErr.name !== 'AbortError') {
            console.warn('[columns] metadata unavailable:', metaErr.message);
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          setError(e.message || 'Failed to load columns');
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { columns, loading, error };
}
