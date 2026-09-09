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
        loadParamMap(data);
        try {
          const described = await describeColumns(controller.signal);
          const byColumn = {};
          const numeric = new Set();
          (described?.columns || []).forEach((c) => {
            byColumn[c.column] = c;
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
  }, []);

  return { columns, loading, error };
}
