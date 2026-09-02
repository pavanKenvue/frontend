/**
 * Shareable URL for a saved bookmark — opening it applies that bookmark's
 * filters on load (see the `?bm=` handling in App.jsx). Mirrors
 * bookmarkUrlFor() from the vanilla index_v6.js implementation.
 */
export function bookmarkUrlFor(id) {
  const u = new URL(window.location.pathname, window.location.origin);
  u.searchParams.set('bm', id);
  return u.toString();
}
