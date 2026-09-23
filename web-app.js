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
if(!isTelegram()){document.getElementById("boot-loader")?.classList.add("hide");document.getElementById("blocked").hidden=false;} else boot();
async function boot(){
 initTelegram(); const app=document.getElementById("app"), loader=document.getElementById("boot-loader"); const wait=ms=>new Promise(r=>setTimeout(r,ms)); await wait(1550); loader?.classList.add("hide"); await wait(180); app.hidden=false;
 function showError(err){app.innerHTML=`<div class="empty">${esc(err.message)}<div class="gap"></div><button class="btn" id="retry">Try again</button></div>`;app.querySelector("#retry").onclick=enter;}
 async function enter(){backButton.hide();app.innerHTML=`<div class="loading">Loading…</div>`;try{const g=await api.getGate();if(!g.passed)return gate.render(app,{gate:g,onPass:enter});}catch(e){return showError(e);}go("home",true);}
 const stack=[]; let current="home";
 async function go(name,silent=false){if(name==="home")stack.length=0;else if(!silent&&current!==name)stack.push(current);current=name;const page=routes[name]||routes.home;app.innerHTML=`<div class="loading">Loading…</div>`;window.scrollTo(0,0);name==="home"?backButton.hide():backButton.show();try{await page.render(app,{go});app.querySelectorAll(".page-back").forEach(b=>b.onclick=()=>go(stack.pop()||"home",true));app.querySelectorAll("[data-go]").forEach(b=>{if(!b.onclick)b.onclick=()=>{tap();go(b.dataset.go);};});}catch(e){if(e.gate)return enter();app.innerHTML=`<div class="empty">Couldn’t load this page.<br>${esc(e.message)}</div>`;}}
 backButton.onClick(()=>go(stack.pop()||"home",true)); window.addEventListener("gpx:gate",enter); enter(); setInterval(async()=>{if(document.hidden||current==="admin")return;try{await api.getMe();}catch(_){ }},15000);
}
