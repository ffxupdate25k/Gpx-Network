import { api } from "./web-api.js";
import { notify, haptic, getUser } from "./web-telegram.js";

let sdkPromise = null;
let inAppStarted = false;
let busy = false;

function zoneId() {
  return window.__GPX_MONETAG_ZONE__ || "11878092";
}
function showFn() {
  const fn = window["show_" + zoneId()];
  return typeof fn === "function" ? fn : null;
}

export async function loadMonetag() {
  if (showFn()) return true;
  try {
    const cfg = await api.ads.status();
    window.__GPX_MONETAG_ZONE__ = cfg.monetag_zone_id || "11878092";
    window.__GPX_MONETAG_SDK_SRC__ = cfg.monetag_sdk_src || "";
  } catch (_) {}

  const src = window.__GPX_MONETAG_SDK_SRC__;
  if (!src) return false;
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[data-gpx-monetag="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(!!showFn()), { once: true });
        existing.addEventListener("error", () => resolve(false), { once: true });
        setTimeout(() => resolve(!!showFn()), 5000);
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.gpxMonetag = "1";
      script.dataset.zone = zoneId();
      script.dataset.sdk = "show_" + zoneId();
      script.onload = () => resolve(!!showFn());
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
      setTimeout(() => resolve(!!showFn()), 7000);
    });
  }
  return sdkPromise;
}

export async function watchAd(button) {
  if (busy) return;
  busy = true;
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Loading ad…"; }
  try {
    const status = await api.ads.status();
    if (status.max_ads_per_day > 0 && status.remaining <= 0) {
      notify("You have reached today's ad limit. Come back tomorrow.");
      return false;
    }
    const ready = await loadMonetag();
    const show = showFn();
    if (!ready || !show) {
      notify("Monetag ads are not ready yet. Ask the admin to configure the Monetag SDK tag.");
      return false;
    }
    const session = await api.ads.start();
    if (button) button.textContent = "Showing ad…";
    await show({ ymid: String(getUser().id || ""), requestVar: "watch_ads" });
    const reward = await api.ads.reward(session.nonce);
    haptic("success");
    notify(`Ad completed! +${Number(reward.reward).toLocaleString()} GPX`);
    window.dispatchEvent(new CustomEvent("gpx:ad-reward", { detail: reward }));
    return true;
  } catch (e) {
    notify(e.message || "The ad could not be completed. Please try again.");
    return false;
  } finally {
    busy = false;
    if (button) { button.disabled = false; button.textContent = old || "Watch Ad"; }
  }
}

export async function startInAppInterstitial() {
  if (inAppStarted) return;
  inAppStarted = true;
  const ready = await loadMonetag();
  const show = showFn();
  if (!ready || !show) return;
  try {
    await show({
      type: "inApp",
      inAppSettings: {
        frequency: 2,
        capping: 0.1,
        interval: 30,
        timeout: 5,
        everyPage: false
      }
    });
  } catch (_) {}
}
