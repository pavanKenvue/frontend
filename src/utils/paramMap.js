const EMPTY = Object.freeze({});

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.filter((x) => x != null).map(String) : [String(v)];
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function looksReversed(map, columnSet) {
  if (!columnSet.size) return false;

  let keyHits = 0;
  let valueHits = 0;

  for (const [key, value] of Object.entries(map)) {
    if (columnSet.has(String(key).toUpperCase())) keyHits += 1;
    if (asArray(value).some((v) => columnSet.has(v.toUpperCase()))) valueHits += 1;
  }

  return valueHits > keyHits;
}

function addPair(columnToParams, column, param) {
  if (!column || !param) return;
  const col = String(column);
  const list = columnToParams.get(col) || [];
  if (!list.includes(String(param))) list.push(String(param));
  columnToParams.set(col, list);
}

export function normalizeParamMap(data) {
  const columns = Array.isArray(data?.columns) ? data.columns.map(String) : [];
  const columnSet = new Set(columns.map((c) => c.toUpperCase()));

  const rawMap = isPlainObject(data?.paramMap) ? data.paramMap : EMPTY;
  const rawFull = isPlainObject(data?.paramMapFull) ? data.paramMapFull : EMPTY;

  const reversed = looksReversed(rawMap, columnSet);
  const columnToParams = new Map();

  for (const [key, value] of Object.entries(rawMap)) {
    if (reversed) {
      asArray(value).forEach((column) => addPair(columnToParams, column, key));
    } else {
      asArray(value).forEach((param) => addPair(columnToParams, key, param));
    }
  }

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

  columns.forEach((col) => {
    if (!columnToParams.has(col)) addPair(columnToParams, col, col);
  });

  const columnToParamsObj = {};
  const paramToColumn = {};
  for (const [col, params] of columnToParams.entries()) {
    columnToParamsObj[col] = params;
    params.forEach((p) => {
      if (!(p in paramToColumn)) paramToColumn[p] = col;
    });
  }

  return { columns, columnToParams: columnToParamsObj, paramToColumn, reversed };
}

export function buildParamIndex(paramToColumn) {
  const lower = new Map();
  Object.entries(paramToColumn || {}).forEach(([param, column]) => {
    lower.set(param.toLowerCase(), { param, column });
  });
  return lower;
}
