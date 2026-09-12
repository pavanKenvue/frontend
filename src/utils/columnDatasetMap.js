import localColumnDatasetMap from '../../column_dataset_map.json';

const S3_URL = import.meta.env.VITE_QS_DATASET_IDENTIFIER_URL || '';
console.log("s3", S3_URL)
const FETCH_TIMEOUT_MS = 5000;

export { localColumnDatasetMap };

export async function loadColumnDatasetMap() {
  if (!S3_URL) {
    return localColumnDatasetMap;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    FETCH_TIMEOUT_MS
  );

  try {
    const res = await fetch(S3_URL, {
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`S3 fetch failed with status ${res.status}`);
    }

    const data = await res.json();

    if (!data || typeof data !== 'object') {
      throw new Error(
        'S3 column_dataset_map.json was not a valid object'
      );
    }
    console.log('[columnDatasetMap] loaded from S3:', S3_URL);
    return data;
  } catch (e) {
    console.warn(
      '[columnDatasetMap] failed to load from S3, falling back:',
      e?.message || e
    );

    return localColumnDatasetMap;
  } finally {
    clearTimeout(timer);
  }
}
