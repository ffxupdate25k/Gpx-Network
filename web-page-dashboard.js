import {api} from "./web-api.js"; import {getUser,getDisplayName,tap} from "./web-telegram.js"; import {icons} from "./web-icons.js"; import {esc,avatarHTML} from "./web-utils.js";
const buttons=[
 {go:"invite",label:"Invite",sub:"Get more GPX",icon:"invite"},{go:"profile",label:"Profile",sub:"View your info",icon:"profile"},
 {go:"promo",label:"Promo Code",sub:"Redeem rewards",icon:"promo"},{go:"leaderboard",label:"Leaderboard",sub:"Top earners",icon:"leaderboard"},
 {go:"task",label:"Tasks",sub:"Complete & earn",icon:"task"},{go:"wallet",label:"Wallet",sub:"Manage your funds",icon:"wallet"}
];
export default{async render(el,{go}){const me=await api.getMe(),u=getUser(),name=getDisplayName();el.innerHTML=`<section class="page">
 <header class="hero"> <div class="brandline"><div class="gpxmark">G</div><div><b>GPX Network</b><small>NETWORK</small></div><span class="dots">•••</span></div>
 <div class="userbar"><div class="avatar">${avatarHTML(u,name)}</div><div><b>@${esc(u.username||name.replace(/\s+/g,""))}</b><small>Level ${me.level} <span class="verify">✓</span></small></div><div class="levelbar"><span style="width:${Math.min(100,me.level_progress)}%"></span></div><em>${me.referrals}/${me.next_level_referrals}</em></div></header>
 <div class="body homebody"><div class="balance"><div><small>Total Balance</small><strong>${Number(me.balance).toLocaleString(undefined,{maximumFractionDigits:2})} GPX</strong><span>≈ $${Number(me.balance*0.0001).toFixed(2)} USDT</span></div><div class="coin">G</div></div>
 <div class="quick"><button data-go="convert">${icons.convert}<b>Convert to USDT</b><small>100 GPX = 0.01 USDT</small></button><button data-go="withdrawal">${icons.wallet}<b>Withdraw</b><small>Max 2/day</small></button></div>
 <div class="grid">${buttons.map(b=>`<button class="tile" data-go="${b.go}"><span class="ic">${icons[b.icon]}</span><b>${b.label}</b><small>${b.sub}</small></button>`).join("")}</div>
 <button class="onchain" data-go="onchain">${icons.transfer}<span><b>Onchain Transfer</b><small>Send & receive GPX</small></span><em>Mini App Only</em></button>
 </div>${bottom("home")}</section>`;bind(el,go);}};
function bottom(active){return `<nav class="bottom"><button data-go="home" class="${active==="home"?"on":""}">${icons.home}<span>Home</span></button><button data-go="task" class="${active==="task"?"on":""}">${icons.task}<span>Tasks</span></button><button data-go="invite" class="${active==="invite"?"on":""}">${icons.invite}<span>Friends</span></button><button data-go="wallet" class="${active==="wallet"?"on":""}">${icons.wallet}<span>Wallet</span></button></nav>`}
export function bind(el,go){el.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{tap();go(b.dataset.go);});}
export {bottom};
