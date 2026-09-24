import {api} from "./web-api.js";
import {watchAd} from "./web-ads.js";
import {pageTop, esc} from "./web-utils.js";
import {notify, haptic} from "./web-telegram.js";

function pct(value, max){
  const v=Number(value||0), m=Number(max||0);
  if(m<=0) return 0;
  return Math.max(0,Math.min(100,(v/m)*100));
}

function bar(label, current, max, suffix=""){
  const p=pct(current,max);
  return `<div class="ad-progress-row">
    <div class="ad-progress-label"><span>${esc(label)}</span><b>${Number(current||0).toLocaleString()} / ${Number(max||0).toLocaleString()}${suffix}</b></div>
    <div class="ad-progress"><span style="width:${p}%"></span></div>
  </div>`;
}

export default {
  async render(el,{go}){
    let s=await api.ads.status();

    const draw=()=>{
      const max=Math.max(0,Number(s.max_ads_per_day||0));
      const watched=Math.max(0,Number(s.watched_today||0));
      const remaining=Math.max(0,Number(s.remaining||0));
      const reward=Number(s.reward_gpx||0);
      const reqAds=Math.max(0,Number(s.required_ads_before_withdrawal||0));
      const reqTasks=Math.max(0,Number(s.required_tasks_before_withdrawal||0));
      const tasks=Number(s.tasks_today||0);
      const earned=watched*reward;
      const withdrawAds=Math.min(watched,reqAds);
      const withdrawTasks=Math.min(tasks,reqTasks);

      el.innerHTML=`<section class="page">
        ${pageTop("Watch Ads & Earn","Complete rewarded ads and earn GPX")}
        <div class="body ads-page-body">

          <div class="ad-hero">
            <div class="ad-orbit"><span>▶</span></div>
            <div class="ad-hero-copy">
              <b>Earn GPX by watching ads</b>
              <small>Each completed rewarded ad credits your GPX balance.</small>
            </div>
            <div class="ad-reward-pill">+${reward.toLocaleString()} GPX</div>
          </div>

          <div class="ad-main-card">
            <div class="ad-main-head">
              <div>
                <small>Today's progress</small>
                <strong>${watched} <span>/ ${max || "∞"}</span></strong>
              </div>
              <div class="ad-ring" style="--p:${max ? pct(watched,max) : 100}%">
                <span>${max ? Math.round(pct(watched,max)) : 100}%</span>
              </div>
            </div>

            ${max ? bar("Daily ads completed",watched,max) : `<div class="ad-unlimited">Daily ad limit is currently disabled.</div>`}

            <div class="ad-stats">
              <div><b>${remaining}</b><small>Ads left today</small></div>
              <div><b>${earned.toLocaleString()}</b><small>GPX earned today</small></div>
              <div><b>${reward.toLocaleString()}</b><small>GPX per ad</small></div>
            </div>

            <button class="btn ad-watch-btn" id="start-watch" ${max>0&&remaining<=0?"disabled":""}>
              ${max>0&&remaining<=0?"Daily limit reached":"▶  Watch an Ad & Earn"}
            </button>
            <p class="ad-note">The reward is added only after the rewarded ad finishes successfully.</p>
          </div>

          <div class="card ad-requirement-card">
            <div class="section-title"><b>Withdrawal progress</b><small>Complete these requirements before withdrawing</small></div>
            ${reqAds>0 ? bar("Ads required",withdrawAds,reqAds) : `<div class="requirement-done">✓ No ad requirement is currently set</div>`}
            ${reqTasks>0 ? bar("Tasks required",withdrawTasks,reqTasks) : `<div class="requirement-done">✓ No task requirement is currently set</div>`}
            <div class="req-summary ${withdrawAds>=reqAds && withdrawTasks>=reqTasks?"ready":""}">
              ${withdrawAds>=reqAds && withdrawTasks>=reqTasks
                ? "✓ Withdrawal requirements completed"
                : `Keep going — ${Math.max(0,reqAds-withdrawAds)} ad(s) and ${Math.max(0,reqTasks-withdrawTasks)} task(s) remaining.`}
            </div>
          </div>

          <div class="card ad-how">
            <div class="section-title"><b>How it works</b></div>
            <div class="how-row"><i>1</i><span><b>Tap Watch an Ad</b><small>A Monetag rewarded ad will open.</small></span></div>
            <div class="how-row"><i>2</i><span><b>Complete the ad</b><small>Wait until the rewarded ad finishes.</small></span></div>
            <div class="how-row"><i>3</i><span><b>Get your GPX</b><small>Your progress updates automatically.</small></span></div>
          </div>
        </div>
        ${bottom("home")}
      </section>`;

      el.querySelector("#start-watch")?.addEventListener("click",async()=>{
        const btn=el.querySelector("#start-watch");
        const ok=await watchAd(btn);
        if(ok){
          try{
            s=await api.ads.status();
            haptic("success");
            draw();
          }catch(e){ notify(e?.message||"Could not refresh ad progress."); }
        }
      });
    };

    draw();
  }
};

function bottom(active){
  const n=(id,label,ic)=>`<button data-go="${id}" class="${active===id?"on":""}">${icon(ic)}<span>${label}</span></button>`;
  return `<nav class="bottom">${n("home","Home","home")}${n("task","Tasks","task")}${n("invite","Friends","invite")}${n("wallet","Wallet","wallet")}${n("profile","Profile","profile")}</nav>`;
}

function icon(name){
  const paths={
    home:'<svg class="icon" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/></svg>',
    task:'<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
    invite:'<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3 2.3-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M17 8v6M14 11h6"/></svg>',
    wallet:'<svg class="icon" viewBox="0 0 24 24"><path d="M4 7.5h15a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M16 13h5"/></svg>',
    profile:'<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.7-4 2.9-6 7-6s6.3 2 7 6"/></svg>'
  };
  return paths[name]||"";
}
