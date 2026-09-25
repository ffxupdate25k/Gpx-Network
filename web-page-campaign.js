import { api } from "./web-api.js";
import { tap, haptic, notify, openAny } from "./web-telegram.js";
import { icons } from "./web-icons.js";
import { pageTop, fail } from "./web-utils.js";
import { bottom } from "./web-page-dashboard.js";

// Its own dedicated page: tapping "Create Campaign" anywhere in the app lands here,
// where the only action is to reach the support contact configured in the Admin Panel
// (Admin Panel → Settings → Campaign / Support). Nothing here messages support itself —
// it just opens the chat, same as any other "open link" action in the app.
export default {
  async render(el) {
    el.innerHTML = `
      <section class="page">
        ${pageTop("Create Campaign", "Promote your project to the GPX Network community")}
        <div class="body">
          <div class="feature">
            <div class="feature-art">${icons.campaign}</div>
            <h2>Run Your Own Campaign</h2>
            <p>Get real users to join your channel, group, bot or app by turning it into a task on GPX Network.</p>
          </div>

          <div class="card listcard">
            <b>How it works</b>
            <div>1️⃣ <span>Contact support with your details</span></div>
            <div>2️⃣ <span>Share your link, budget and task type</span></div>
            <div>3️⃣ <span>Support reviews and sets it live</span></div>
            <div>4️⃣ <span>Your task appears to GPX Network users</span></div>
          </div>

          <button class="btn" id="contact-support">💬 Contact Support</button>

          <div class="locknote" id="campaign-warning">
            ⚠️ <b>Important:</b> Only message the campaign admin about creating a campaign.
            DMing them for anything unrelated to campaign creation may get your account
            permanently banned from GPX Network.
          </div>
        </div>
        ${bottom("home")}
      </section>`;

    el.querySelector("#contact-support").onclick = async () => {
      tap();
      try {
        const me = await api.getMe();
        const link = me.support_telegram_link;
        if (!link) return notify("Support contact isn't set up yet. Please try again later.");
        haptic("success");
        openAny(link);
      } catch (e) {
        fail(e);
      }
    };
  }
};
