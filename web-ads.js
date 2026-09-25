import { api } from "./web-api.js";
import { notify, haptic, getUser } from "./web-telegram.js";
import { emitActivity } from "./web-live.js";

const MONETAG_ZONE_ID = "11878092";
const MONETAG_SDK_SRC = "https://libtl.com/sdk.js";

let sdkPromise = null;
let inAppStarted = false;
let busy = false;

function zoneId() {
  return MONETAG_ZONE_ID;
}

function showFn() {
  const fn = window["show_" + MONETAG_ZONE_ID];
  return typeof fn === "function" ? fn : null;
}

export async function loadMonetag() {
  if (showFn()) return true;

  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[data-gpx-monetag="1"]');
      if (existing) {
        if (showFn()) return resolve(true);
        existing.addEventListener("load", () => resolve(!!showFn()), { once: true });
        existing.addEventListener("error", () => resolve(false), { once: true });
        setTimeout(() => resolve(!!showFn()), 7000);
        return;
      }

      const script = document.createElement("script");
      script.src = MONETAG_SDK_SRC;
      script.async = true;
      script.dataset.gpxMonetag = "1";
      script.dataset.zone = MONETAG_ZONE_ID;
      script.dataset.sdk = "show_" + MONETAG_ZONE_ID;
      script.onload = () => resolve(!!showFn());
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
      setTimeout(() => resolve(!!showFn()), 7000);
    });
  }

  return sdkPromise;
}

export async function watchAd(button) {
  if (busy) return false;
  busy = true;

  const old = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading ad…";
  }

  try {
    const status = await api.ads.status();

    if (status.max_ads_per_day > 0 && status.remaining <= 0) {
      notify("You have reached today's ad limit. Come back tomorrow.");
      return false;
    }

    const ready = await loadMonetag();
    const show = showFn();

    if (!ready || !show) {
      notify("Monetag is still loading. Please try again in a few seconds.");
      return false;
    }

    const session = await api.ads.start();
    if (button) button.textContent = "Showing ad…";

    // Rewarded Interstitial: reward is granted by our server only after
    // this Promise resolves successfully.
    await show();

    const reward = await api.ads.reward(session.nonce);
    haptic("success");
    notify(`Ad completed! +${Number(reward.reward).toLocaleString()} GPX`);
    window.dispatchEvent(new CustomEvent("gpx:ad-reward", { detail: reward }));
    emitActivity({ type: "ad", reward: reward.reward });
    return true;
  } catch (e) {
    notify(e?.message || "The ad could not be completed. Please try again.");
    return false;
  } finally {
    busy = false;
    if (button) {
      button.disabled = false;
      button.textContent = old || "Watch Ad";
    }
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
  } catch (_) {
    // Automatic ads must never break the Mini App UI.
  }
}
