/**
 * Normalizes the /columns paramMap into a shape the app can rely on.
 *
 * The documented contract is:
 *   paramMap:     { [column]: paramName }
 *   paramMapFull: { [column]: paramName[] }
 *
 * ...but the live API returns it the other way round ({ [paramName]: column }),
 * which is why every lookup in the app had been hand-patched to use the column
 * name as the parameter name. Rather than flipping it blindly — and breaking
 * again the day the backend is corrected — we detect the orientation using the
 * `columns` array from the same response as ground truth:
 *
 *   - if the map's KEYS look like columns  -> column -> param (documented)
 *   - if the map's VALUES look like columns -> param -> column (reversed)
 *
 * Everything downstream then consumes the normalized result and never has to
 * care which way the payload arrived.
 */

const EMPTY = Object.freeze({});

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.filter((x) => x != null).map(String) : [String(v)];
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Decides whether `map` is keyed by column (false) or by parameter (true).
 * Falls back to the documented orientation when `columns` gives us nothing
 * to compare against.
 */
function looksReversed(map, columnSet) {
  if (!columnSet.size) return false;

  let keyHits = 0;
  let valueHits = 0;

  for (const [key, value] of Object.entries(map)) {
    if (columnSet.has(String(key).toUpperCase())) keyHits += 1;
    if (asArray(value).some((v) => columnSet.has(v.toUpperCase()))) valueHits += 1;
  }

  // Strictly greater: ties keep the documented orientation.
  return valueHits > keyHits;
}

function addPair(columnToParams, column, param) {
  if (!column || !param) return;
  const col = String(column);
  const list = columnToParams.get(col) || [];
  if (!list.includes(String(param))) list.push(String(param));
  columnToParams.set(col, list);
}

/**
 * @param {object} data raw GET /columns response
 * @returns {{
 *   columns: string[],
 *   columnToParams: Record<string, string[]>,
 *   paramToColumn: Record<string, string>,
 *   reversed: boolean
 * }}
 */
export function normalizeParamMap(data) {
  const columns = Array.isArray(data?.columns) ? data.columns.map(String) : [];
  const columnSet = new Set(columns.map((c) => c.toUpperCase()));

  const rawMap = isPlainObject(data?.paramMap) ? data.paramMap : EMPTY;
  const rawFull = isPlainObject(data?.paramMapFull) ? data.paramMapFull : EMPTY;

  const reversed = looksReversed(rawMap, columnSet);
  const columnToParams = new Map();

  // Primary map.
  for (const [key, value] of Object.entries(rawMap)) {
    if (reversed) {
      // { param: column } — a column may legitimately appear under several params.
      asArray(value).forEach((column) => addPair(columnToParams, column, key));
    } else {
      asArray(value).forEach((param) => addPair(columnToParams, key, param));
    }
  }

  // paramMapFull carries the extra parameters for columns bound to more than
  // one control. Its orientation is detected independently.
  if (Object.keys(rawFull).length) {
    const fullReversed = looksReversed(rawFull, columnSet);
    for (const [key, value] of Object.entries(rawFull)) {
      if (fullReversed) {
        asArray(value).forEach((column) => addPair(columnToParams, column, key));
      } else {
        asArray(value).forEach((param) => addPair(columnToParams, key, param));
      }
    }
  }

  // Any column with no parameter at all falls back to itself — several
  // QuickSight controls in this dashboard are named exactly like their column.
  columns.forEach((col) => {
    if (!columnToParams.has(col)) addPair(columnToParams, col, col);
  });

  const columnToParamsObj = {};
  const paramToColumn = {};
  for (const [col, params] of columnToParams.entries()) {
    columnToParamsObj[col] = params;
    params.forEach((p) => {
      // First column wins if two columns somehow claim the same parameter.
      if (!(p in paramToColumn)) paramToColumn[p] = col;
    });
  }

  return { columns, columnToParams: columnToParamsObj, paramToColumn, reversed };
}

/**
 * Case-insensitive parameter lookup, since control names in QuickSight are
 * not always cased the way the registry stores them.
 */
export function buildParamIndex(paramToColumn) {
  const lower = new Map();
  Object.entries(paramToColumn || {}).forEach(([param, column]) => {
    lower.set(param.toLowerCase(), { param, column });
  });
  return lower;
}
