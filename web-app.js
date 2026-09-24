import { isTelegram, initTelegram, backButton, tap } from "./web-telegram.js";
import { api } from "./web-api.js";
import { esc } from "./web-utils.js";
import gate from "./web-page-gate.js";
import dashboard from "./web-page-dashboard.js";
import profile from "./web-page-profile.js";
import invite from "./web-page-invite.js";
import convert from "./web-page-convert.js";
import onchain from "./web-page-onchain.js";
import wallet from "./web-page-wallet.js";
import task from "./web-page-task.js";
import leaderboard from "./web-page-leaderboard.js";
import promo from "./web-page-promo.js";
import withdrawal from "./web-page-withdrawal.js";
import admin from "./web-page-admin.js";
const routes={home:dashboard,profile,invite,convert,onchain,wallet,task,leaderboard,promo,withdrawal,admin};
if(!isTelegram()){document.getElementById("blocked").hidden=false;document.getElementById("boot-loader")?.remove();document.getElementById("route-loader")?.remove();} else boot();
async function boot(){
 initTelegram(); const app=document.getElementById("app"); app.hidden=false;
 const bootLoader=document.getElementById("boot-loader"), routeLoader=document.getElementById("route-loader");
 const hideBoot=()=>{if(bootLoader){bootLoader.classList.add("hide");setTimeout(()=>bootLoader.remove(),300);}};
 const showRoute=()=>{if(routeLoader){routeLoader.classList.add("show");}};
 const hideRoute=()=>{if(routeLoader){routeLoader.classList.remove("show");}};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));

 function showError(err){app.innerHTML=`<div class="empty">${esc(err.message)}<div class="gap"></div><button class="btn" id="retry">Try again</button></div>`;app.querySelector("#retry").onclick=enter;}
 async function enter(){
  backButton.hide(); app.innerHTML=""; const started=performance.now();
  try{const g=await api.getGate();if(!g.passed){await gate.render(app,{gate:g,onPass:enter});return;}}
  catch(e){showError(e);return;}
  await go("home",true);
  await wait(Math.max(0,700-(performance.now()-started)));
  hideBoot();
}
 const stack=[]; let current="home";
 async function go(name,silent=false){
  if(name==="home")stack.length=0;else if(!silent&&current!==name)stack.push(current);
  current=name;const page=routes[name]||routes.home;window.scrollTo(0,0);name==="home"?backButton.hide():backButton.show();
  const navStarted=performance.now(); if(!silent)showRoute();
  try{await page.render(app,{go});
    if(!silent) await wait(Math.max(0,300-(performance.now()-navStarted)));
    if(!silent) hideRoute();
app.querySelectorAll(".page-back").forEach(b=>b.onclick=()=>go(stack.pop()||"home",true));app.querySelectorAll("[data-go]").forEach(b=>{if(!b.onclick)b.onclick=()=>{tap();go(b.dataset.go);};});}catch(e){if(!silent)hideRoute();if(e.gate)return enter();app.innerHTML=`<div class="empty">Couldn’t load this page.<br>${esc(e.message)}</div>`;}}
 backButton.onClick(()=>go(stack.pop()||"home",true)); window.addEventListener("gpx:gate",enter); enter(); setInterval(async()=>{if(document.hidden||current==="admin")return;try{await api.getMe();}catch(_){ }},15000);
}
