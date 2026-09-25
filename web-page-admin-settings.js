import{api}from"./web-api.js";
import{notify,haptic}from"./web-telegram.js";
import{esc,fail}from"./web-utils.js";

export default{async render(el){
  const s=await api.admin.getSettings();
  el.innerHTML=`
  <div class="card">
    <b>GPX Economy</b>
    <label>GPX → USDT rate (GPX per 0.01 USDT)</label><input id="rate" type="number" value="${s.gpx_per_001_usdt}">
    <label>Minimum conversion (GPX)</label><input id="minconv" type="number" value="${s.min_conversion_gpx}">
    <label>Referral reward (GPX)</label><input id="ref" type="number" value="${s.referral_reward}">
    <label>Maximum withdrawals per day</label><input id="wdlimit" type="number" value="${s.withdrawals_per_day}">
    <label>Minimum withdrawal (USDT)</label><input id="minwd" type="number" step="0.01" value="${s.min_withdraw}">
    <label>Maximum withdrawal (USDT, 0 = no limit)</label><input id="maxwd" type="number" step="0.01" value="${s.max_withdraw}">
    <label>Withdrawal fee (USDT)</label><input id="wdf" type="number" min="0" step="0.01" value="${s.withdrawal_fee}">
    <p class="hint">The withdrawal fee is an admin-only setting and is not shown to users.</p>
  </div>

  <div class="card">
    <b>Referral reward message</b>
    <p class="hint">This is the Telegram message sent to the referrer after a referral is successfully completed.</p>
    <textarea id="refmsg" rows="10" maxlength="3500">${esc(s.referral_reward_message||"")}</textarea>
    <p class="hint">
      Variables:
      <b>{{name}}</b>, <b>{{username}}</b>, <b>{{first_name}}</b>, <b>{{last_name}}</b>,
      <b>{{user_id}}</b>, <b>{{reward}}</b>, <b>{{referrals}}</b>, <b>{{level}}</b>,
      <b>{{date}}</b>, <b>{{milestone}}</b>.
      You can use single braces too, e.g. <b>{name}</b>.
    </p>
  </div>

  <div class="card">
    <b>Monetag Rewards</b>
    <p class="hint">Users receive the GPX reward only after the Monetag rewarded ad Promise completes.</p>
    <p class="hint">Monetag is built into this version (Zone 11878092). The SDK URL is fixed in the app and is not editable here.</p>
    <label>GPX reward per completed ad</label><input id="adreward" type="number" min="0" step="1" value="${s.ad_reward_gpx}">
    <label>Maximum ads per user per day</label><input id="admax" type="number" min="0" step="1" value="${s.max_ads_per_day}">
    <label>Ads required before withdrawal</label><input id="adreq" type="number" min="0" step="1" value="${s.required_ads_before_withdrawal}">
    <label>Tasks required before withdrawal</label><input id="taskreq" type="number" min="0" step="1" value="${s.required_tasks_before_withdrawal}">
    <label>Withdrawal cooldown (hours, 0 = disabled)</label><input id="cooldown" type="number" min="0" step="0.1" value="${s.withdrawal_cooldown_hours}">
  </div>

  <div class="card">
    <b>Referral milestones</b>
    <p class="hint">JSON format: [{"referrals":100,"reward":500},{"referrals":500,"reward":2500},{"referrals":1000,"reward":10000}]</p>
    <textarea id="milestones" rows="6">${esc(JSON.stringify(s.referral_milestones,null,2))}</textarea>
  </div>

  <div class="card">
    <b>Wallet & notifications</b>
    <label class="check"><input id="notify" type="checkbox" ${s.notifications_default?"checked":""}> Notifications enabled by default</label>
    <p class="hint">New referrals, successful withdrawals and incoming GPX transfers are sent by the bot to the user's Telegram chat.</p>
  </div>

  <div class="card">
    <b>Withdrawal payout service</b>
    <p class="hint">Every withdrawal stays pending until an admin taps <b>Approve & Send</b>.</p>
    <label>Payout API address</label><input id="url" value="${esc(s.payout_api_url)}">
    <label>Payout API key</label><input id="key" type="password" placeholder="${s.has_api_key?"Saved ("+s.api_key_hint+")":"Paste API key"}">
    <label>USDT token address</label><input id="token" value="${esc(s.payout_token_address)}">
    <label class="check"><input id="pch" type="checkbox" ${s.payout_channel_enabled?"checked":""}> Post approved withdrawals to payout channel</label>
    <label>Payout channel (@username or numeric ID)</label><input id="pchannel" value="${esc(s.payout_channel||"")}" placeholder="@your_payout_channel">
  </div>

  <div class="card">
    <b>Campaign / Support</b>
    <p class="hint">Shown on the user-facing "Create Campaign" page and used as the "Contact Support" link. Users are warned there not to DM this contact for anything other than campaign creation.</p>
    <label>Support Telegram link (https://t.me/...)</label><input id="supportlink" value="${esc(s.support_telegram_link||"")}" placeholder="https://t.me/gpxlivesupport">
  </div>

  <div class="card">
    <b>Bot welcome</b>
    <textarea id="welcome">${esc(s.welcome_text)}</textarea>
    <label>Welcome photo URL</label><input id="photo" value="${esc(s.welcome_photo_url||"")}">
    <label>Premium emoji IDs</label><input id="emojis" value="${esc(s.welcome_emoji_ids||"")}">
  </div>

  <button class="btn" id="save">Save all settings</button>`;

  el.querySelector("#save").onclick=async()=>{
    const btn=el.querySelector("#save");
    btn.disabled=true;
    try{
      let ms;
      try{ms=JSON.parse(el.querySelector("#milestones").value)}
      catch(_){throw new Error("Referral milestones JSON is invalid.")}
      await api.admin.saveSettings({
        gpx_per_001_usdt:el.querySelector("#rate").value,
        min_conversion_gpx:el.querySelector("#minconv").value,
        referral_reward:el.querySelector("#ref").value,
        referral_reward_message:el.querySelector("#refmsg").value,
        withdrawals_per_day:el.querySelector("#wdlimit").value,
        min_withdraw:el.querySelector("#minwd").value,
        max_withdraw:el.querySelector("#maxwd").value,
        withdrawal_fee:el.querySelector("#wdf").value,
        ad_reward_gpx:el.querySelector("#adreward").value,
        max_ads_per_day:el.querySelector("#admax").value,
        required_ads_before_withdrawal:el.querySelector("#adreq").value,
        required_tasks_before_withdrawal:el.querySelector("#taskreq").value,
        withdrawal_cooldown_hours:el.querySelector("#cooldown").value,
        referral_milestones:ms,
        notifications_default:el.querySelector("#notify").checked,
        auto_payout:false,
        payout_api_url:el.querySelector("#url").value,
        payout_api_key:el.querySelector("#key").value,
        payout_token_address:el.querySelector("#token").value,
        payout_channel_enabled:el.querySelector("#pch").checked,
        payout_channel:el.querySelector("#pchannel").value,
        welcome_text:el.querySelector("#welcome").value,
        welcome_photo_url:el.querySelector("#photo").value,
        welcome_emoji_ids:el.querySelector("#emojis").value,
        support_telegram_link:el.querySelector("#supportlink").value
      });
      el.querySelector("#key").value="";
      notify("Settings saved.");
      haptic("success");
    }catch(e){fail(e)}
    btn.disabled=false;
  };
}};
