import {api} from "./web-api.js"; import {getUser,getDisplayName,tap} from "./web-telegram.js"; import {icons} from "./web-icons.js"; import {esc,avatarHTML} from "./web-utils.js";

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
  <div class="grid">${tiles.map(b=>`<div class="tile ${b.tone}" data-go="${b.go}" role="button" tabindex="0"><span class="ic">${icons[b.icon]}</span><b>${b.label}</b><small>${b.sub}</small><span class="tbtn">${b.btn}</span></div>`).join("")}</div>
 </div>${bottom("home")}</section>`;bind(el,go);}};
function bottom(active){const n=(id,label,ic)=>`<button data-go="${id}" class="${active===id?"on":""}">${icons[ic]}<span>${label}</span></button>`;return `<nav class="bottom">${n("home","Home","home")}${n("task","Tasks","task")}${n("invite","Friends","invite")}${n("wallet","Wallet","wallet")}${n("profile","Profile","profile")}</nav>`}
export function bind(el,go){el.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{tap();go(b.dataset.go);});}
export {bottom};
