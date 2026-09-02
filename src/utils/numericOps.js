// Ported from cascading_filter_v4.js — lets numeric columns accept typed
// tokens like ">50", "<=30", "=45" that expand to every matching known value.
export const NUMERIC_OP_RE = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)\s*$/;

export function parseNumericOp(token) {
  const match = token.match(NUMERIC_OP_RE);
  if (!match) return null;
  const [, op, numStr] = match;
  return { op, num: parseFloat(numStr) };
}

export function valueMatchesOp(value, op, num) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return false;
  switch (op) {
    case '>':
      return n > num;
    case '<':
      return n < num;
    case '>=':
      return n >= num;
    case '<=':
      return n <= num;
    default:
      return n === num; // '='
  }
}

export function filterValuesByOp(values, op, num) {
  return values.filter((v) => valueMatchesOp(v, op, num));
}

// True if two raw values represent the same underlying value. Numeric
// columns often end up with the same value in more than one textual form —
// e.g. a value typed into "or type values" before its column was ever
// searched (so it couldn't be canonicalized against known values) stays as
// the literal "100489", while the column's own value list stores the
// canonical "100489.0" — and plain string/array-includes equality treats
// those as two different values instead of the same one.
export function valuesMatch(a, b) {
  const aStr = String(a);
  const bStr = String(b);
  if (aStr === bStr) return true;
  if (aStr === '' || bStr === '') return false;
  const an = Number(aStr);
  const bn = Number(bStr);
  return !Number.isNaN(an) && !Number.isNaN(bn) && an === bn;
}

// Sort helper used by the values list: numeric or alphabetical.
//
// `validValuesSet` is optional and no longer passed by ValuesList — the list is
// cascaded server-side, so there is no disabled group to sort to the bottom.
// Kept for callers that still want enabled-first ordering.
export function sortValues(values, validValuesSet) {
  return [...values].sort((a, b) => {
    const aDisabled = validValuesSet ? !validValuesSet.has(String(a)) : false;
    const bDisabled = validValuesSet ? !validValuesSet.has(String(b)) : false;
    if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
    const an = Number(a);
    const bn = Number(b);
    const bothNumeric = a !== '' && b !== '' && !Number.isNaN(an) && !Number.isNaN(bn);
    return bothNumeric ? an - bn : String(a).localeCompare(String(b));
  });
}
