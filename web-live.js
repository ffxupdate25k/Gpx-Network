// Tiny pub/sub so the currently mounted page can refresh itself the instant a
// balance-changing activity happens (watching an ad, completing a task, redeeming a
// promo code, converting GPX), instead of only updating on the next full navigation.
// Only one page is ever mounted at a time in this app, so each call to onActivity()
// replaces whatever the previously-mounted page was listening for.
let currentHandler = null;

export function onActivity(handler) {
  if (currentHandler) window.removeEventListener("gpx:activity", currentHandler);
  currentHandler = (e) => { try { handler(e.detail || {}); } catch (_) { /* never let a refresh glitch break the page */ } };
  window.addEventListener("gpx:activity", currentHandler);
}

export function emitActivity(detail) {
  window.dispatchEvent(new CustomEvent("gpx:activity", { detail: detail || {} }));
}
