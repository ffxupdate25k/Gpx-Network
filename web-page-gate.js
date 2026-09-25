// Advanced required-channel gate. Users must join every active channel before entering.
import { api } from "./web-api.js";
import { openAny, haptic, notify, tap } from "./web-telegram.js";
import { icons } from "./web-icons.js";
import { esc } from "./web-utils.js";

export default {
  render(el, { gate, onPass }) {
    let channels = gate.channels;
    let disposed = false;
    let checking = false;
    let lastCheckAt = 0;

    function draw() {
      const joined = channels.filter(c => c.joined).length;
      const total = channels.length;
      const percent = total ? Math.round((joined / total) * 100) : 100;
      const allJoined = total > 0 && joined === total;

      el.innerHTML = `
        <section class="page gate-advanced">
          <div class="gate-hero gate-hero-pro">
            <div class="gate-orb">${icons.lock}</div>
            <span class="gate-kicker">GPX NETWORK</span>
            <h1>Unlock your account</h1>
            <p>Join the required communities below. Once all are joined, this updates automatically — or tap verify to check right away.</p>
            <div class="gate-progress">
              <div class="gate-progress-top">
                <b>${joined}/${total} joined</b>
                <span>${percent}%</span>
              </div>
              <div class="gate-progress-track"><i style="width:${percent}%"></i></div>
            </div>
          </div>

          <div class="body gate-body">
            <div class="gate-list">
              ${channels.map((c, index) => `
                <div class="gate-channel ${c.joined ? "is-joined" : ""} ${c.error ? "has-error" : ""}">
                  <div class="gate-channel-icon">${c.joined ? "✓" : "✦"}</div>
                  <div class="gate-channel-main">
                    <div class="gate-channel-title">
                      <b>${esc(c.title || "Required channel")}</b>
                      <span class="gate-status ${c.joined ? "ok" : c.error ? "warn" : ""}">
                        ${c.joined ? "Joined" : c.error ? "Check unavailable" : "Required"}
                      </span>
                    </div>
                    <small>${c.joined ? "Membership confirmed" : c.error ? "Could not verify this channel. Tap verify again; if it keeps failing, contact support." : "Join this community to continue"}</small>
                  </div>
                  ${c.joined
                    ? `<div class="gate-check">✓</div>`
                    : `<button class="gate-join-btn" data-join="${c.id}">Join</button>`}
                </div>
              `).join("")}
            </div>

            ${allJoined ? `
              <div class="gate-ready">
                <span>✓</span>
                <div><b>Everything is ready</b><small>All required channels have been verified.</small></div>
              </div>` : `
              <div class="gate-tip" id="gate-live-note">Join every channel above. We'll check automatically as soon as you come back — no need to tap anything.</div>`}

            <button class="btn gate-verify-btn" id="verify" ${total === 0 ? "" : ""}>
              ${allJoined ? "Continue to GPX Network" : "I've joined — Verify"}
            </button>
          </div>
        </section>`;

      el.querySelectorAll("[data-join]").forEach((b) => {
        b.onclick = () => {
          tap();
          const ch = channels.find((x) => String(x.id) === b.dataset.join);
          if (ch && ch.url) {
            b.textContent = "Opening…";
            b.disabled = true;
            openAny(ch.url);
            setTimeout(() => { if (b.isConnected) { b.textContent = "Join"; b.disabled = false; } }, 1200);
          } else {
            notify("No join link is configured for this channel.");
          }
        };
      });

      const verify = el.querySelector("#verify");
      verify.onclick = async () => {
        verify.disabled = true;
        verify.textContent = "Checking membership…";
        try {
          const res = await api.getGate();
          if (res.passed) {
            haptic("success");
            dispose();
            return onPass();
          }
          channels = res.channels;
          haptic("error");
          draw();
          notify(channels.some(c => c.error && !c.joined)
            ? "One or more channels could not be checked. Try again shortly."
            : "A few channels are still waiting for you. Join them and verify again.");
        } catch (err) {
          verify.disabled = false;
          verify.textContent = "I've joined — Verify";
          notify(err.message);
        }
      };
    }

    // Silent auto-recheck: fires the instant the user comes back to the Mini App
    // after opening a join link (so tapping Join and joining is enough — no need
    // to also tap Verify), plus a slow background poll as a safety net for
    // Telegram clients that don't reliably fire visibility/focus events.
    async function silentRecheck() {
      if (disposed || checking) return;
      const now = Date.now();
      if (now - lastCheckAt < 1200) return;
      checking = true; lastCheckAt = now;
      try {
        const res = await api.getGate();
        if (disposed) return;
        channels = res.channels;
        draw();
        if (res.passed) {
          haptic("success");
          dispose();
          setTimeout(onPass, 500);
        }
      } catch (e) {
        // Stay silent — the manual Verify button still works if this keeps failing.
      } finally {
        checking = false;
      }
    }

    function onVisible() {
      if (!disposed && document.visibilityState === "visible") silentRecheck();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const pollId = setInterval(() => { if (!disposed) silentRecheck(); }, 5000);

    function dispose() {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(pollId);
    }

    draw();
  }
};
