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
      return n === num;
  }
}

export function filterValuesByOp(values, op, num) {
  return values.filter((v) => valueMatchesOp(v, op, num));
}

export function valuesMatch(a, b) {
  const aStr = String(a);
  const bStr = String(b);
  if (aStr === bStr) return true;
  if (aStr === '' || bStr === '') return false;
  const an = Number(aStr);
  const bn = Number(bStr);
  return !Number.isNaN(an) && !Number.isNaN(bn) && an === bn;
}

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
