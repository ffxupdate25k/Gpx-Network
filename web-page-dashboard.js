import {api} from "./web-api.js"; import {getUser,getDisplayName,tap,notify,haptic} from "./web-telegram.js"; import {icons} from "./web-icons.js"; import {esc,avatarHTML} from "./web-utils.js";

// Big, bold cards. Each one fills its half of the screen and ends with a full-width action button.
const tiles=[
 {go:"convert",label:"Convert",sub:"GPX to USDT",icon:"convert",btn:"Convert Now",tone:"green"},
 {go:"invite",label:"Invite",sub:"Get more GPX",icon:"invite",btn:"Invite Friends",tone:"teal"},
 {go:"task",label:"Tasks",sub:"Complete & earn",icon:"task",btn:"View Tasks",tone:"green"},
 {go:"promo",label:"Promo Code",sub:"Redeem rewards",icon:"promo",btn:"Redeem",tone:"teal"},
 {go:"leaderboard",label:"Leaderboard",sub:"Top earners",icon:"leaderboard",btn:"View Ranking",tone:"green"},
 {go:"wallet",label:"Wallet",sub:"Manage your funds",icon:"wallet",btn:"Open Wallet",tone:"teal"}
];
export default{async render(el,{go}){
 const me=await api.getMe(),u=getUser(),name=getDisplayName();
 // The Admin Panel card is always on the dashboard for every ID listed in the ADMIN_IDS environment variable.
 const admin=me.is_admin?`<button class="banner admin" data-go="admin"><span class="bic">${icons.settings}</span><span class="btxt"><b>Admin Panel <em>ADMIN</em></b><small>Manage users, tasks, payouts & settings</small></span><span class="bbtn">Open ›</span></button>`:"";
 el.innerHTML=`<section class="page">
 <header class="hero"> <div class="brandline"><div class="gpxmark">G</div><div><b>GPX Network</b><small>NETWORK</small></div><span class="dots">•••</span></div>
 <div class="userbar"><div class="avatar">${avatarHTML(u,name)}</div><div><b>@${esc(u.username||name.replace(/\s+/g,""))}</b><small>Level ${me.level} <span class="verify">✓</span></small></div><div class="levelbar"><span style="width:${Math.min(100,me.level_progress)}%"></span></div><em>${me.referrals}/${me.next_level_referrals}</em></div></header>
 <div class="body homebody">
  <div class="balance"><div><small>Total Balance</small><strong>${Number(me.balance).toLocaleString(undefined,{maximumFractionDigits:2})} <i>GPX</i></strong><span>≈ $${Number(me.balance*0.0001).toFixed(2)} USDT</span></div><button class="wd" data-go="withdrawal">${icons.transfer}Withdraw</button></div>
  ${admin}
  <button class="banner" data-go="onchain"><span class="bic">${icons.transfer}</span><span class="btxt"><b>Onchain Transfer</b><small>Send & receive GPX instantly</small></span><span class="bbtn">Open ›</span></button>
  <button class="banner" data-go="support"><span class="bic">?</span><span class="btxt"><b>Support</b><small>Chat with GPX Support AI</small></span><span class="bbtn">Chat ›</span></button>
  <button class="banner ad-banner" id="watchAds"><span class="bic">▶</span><span class="btxt"><b>Watch Ads & Earn</b><small id="adSub">Watch Monetag ads to earn GPX</small></span><span class="bbtn">Watch ›</span></button>
  <div class="grid">${tiles.map(b=>`<div class="tile ${b.tone}" data-go="${b.go}" role="button" tabindex="0"><span class="ic">${icons[b.icon]}</span><b>${b.label}</b><small>${b.sub}</small><span class="tbtn">${b.btn}</span></div>`).join("")}</div>
 </div>${bottom("home")}</section>`;bind(el,go);
 try{const adcfg=await api.getAdStats(); const fn=window['show_'+adcfg.zone_id]; if(adcfg.monetag_enabled&&typeof fn==='function'){fn({type:'inApp',inAppSettings:{frequency:2,capping:0.1,interval:30,timeout:5,everyPage:false}}).catch(()=>{});}}catch(_){}
 const ad=el.querySelector('#watchAds'); if(ad){ad.onclick=async()=>{try{const st=await api.getAdStats(); if(!st.monetag_enabled)return notify('Ads are currently disabled.'); if(st.watched_today>=st.max_ads_per_day)return notify('You reached today's ad limit.'); const fn=window['show_'+st.zone_id]; if(typeof fn!=='function')return notify('Monetag ad service is not ready yet.'); ad.disabled=true; ad.querySelector('.bbtn').textContent='Watching…'; await fn(); const r=await api.watchAd({format:'rewarded'}); notify(`+${Number(r.reward).toLocaleString()} GPX earned.`); ad.querySelector('#adSub')?.replaceChildren(document.createTextNode(`${r.watched_today}/${r.max_ads_per_day} ads today`)); haptic('success'); }catch(e){notify(e.message||'Ad could not be completed.')}finally{ad.disabled=false;ad.querySelector('.bbtn').textContent='Watch ›';}}}
 }};
function bottom(active){const n=(id,label,ic)=>`<button data-go="${id}" class="${active===id?"on":""}">${icons[ic]}<span>${label}</span></button>`;return `<nav class="bottom">${n("home","Home","home")}${n("task","Tasks","task")}${n("invite","Friends","invite")}${n("wallet","Wallet","wallet")}${n("profile","Profile","profile")}</nav>`}
export function bind(el,go){el.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{tap();go(b.dataset.go);});}
export {bottom};
