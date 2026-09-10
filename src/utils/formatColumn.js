export function formatColumnLabel(col) {
  return typeof col === 'string' ? col.replace(/_/g, ' ') : col;
}
