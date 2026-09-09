export function bookmarkUrlFor(id) {
  const u = new URL(window.location.pathname, window.location.origin);
  u.searchParams.set('bm', id);
  return u.toString();
}
