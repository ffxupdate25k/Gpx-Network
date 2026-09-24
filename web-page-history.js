import { api } from "./web-api.js";
import { fail, esc } from "./web-utils.js";
import { bottom } from "./web-page-dashboard.js";

const tabs = [
  ["withdrawal","Withdrawals"],
  ["task","Tasks"],
  ["ad","Ads"],
  ["referral","Referrals"]
];

function icon(type){ return type==="withdrawal"?"↓":type==="task"?"✓":type==="ad"?"▶":"♟"; }
function label(type){ return type==="withdrawal"?"Withdrawal":type==="task"?"Task Reward":type==="ad"?"Ad Reward":"Referral Reward"; }

export default {
  async render(el) {
    let all = [];
    let active = "withdrawal";

    const detail = (x) => {
      const amount = Math.abs(Number(x.amount||0));
      const isWithdrawal = x.type === "withdrawal";
      return `<div class="history-detail card">
        <button class="btn ghost" id="close-detail">‹ Back to History</button>
        <div class="detail-icon">${icon(x.type)}</div>
        <h2>${esc(label(x.type))}</h2>
        <div class="row"><span>Amount</span><b>${amount.toFixed(isWithdrawal?2:0)} ${isWithdrawal?"USDT":"GPX"}</b></div>
        <div class="row"><span>Status</span><b>${esc(String(x.status||"completed"))}</b></div>
        <div class="row"><span>Date</span><b>${new Date(x.date).toLocaleString()}</b></div>
        ${isWithdrawal ? `
          <div class="row"><span>Withdrawal ID</span><b>#${x.withdrawal_id}</b></div>
          <div class="row"><span>Network</span><b>BEP20 (BNB Smart Chain)</b></div>
          <div class="row"><span>Payout Address</span><b class="wrap">${esc(x.withdrawal_address||"-")}</b></div>
          <div class="row"><span>Processing</span><b>${esc(x.withdrawal_payout_state||x.status||"pending")}</b></div>
          ${x.withdrawal_tx_hash?`<div class="row"><span>Transaction Hash</span><b class="wrap">${esc(x.withdrawal_tx_hash)}</b></div>`:""}
          ${x.withdrawal_note?`<div class="info">${esc(x.withdrawal_note)}</div>`:""}
        ` : `<div class="row"><span>Details</span><b>${esc(x.title||label(x.type))}</b></div>`}
      </div>`;
    };

    const draw = () => {
      const rows = all.filter(x => x.type === active);
      el.innerHTML = `<section class="page">
        <div class="top"><button class="page-back">‹</button><div class="top-copy"><h1>History</h1><p>Your activity and transaction records</p></div></div>
        <div class="tabs history-tabs">${tabs.map(([id,name])=>`<button class="tab ${id===active?"on":""}" data-tab="${id}">${name}</button>`).join("")}</div>
        <div class="body"><div class="card">
          ${rows.length ? rows.map((x,i)=>`<button class="history-row" data-index="${all.indexOf(x)}">
            <span class="txicon">${icon(x.type)}</span><span class="history-main"><b>${esc(x.title||label(x.type))}</b><small>${new Date(x.date).toLocaleString()} · ${esc(String(x.status||"completed"))}</small></span>
            <strong class="${Number(x.amount)>=0?"plus":"minus"}">${Number(x.amount)>=0?"+":"−"}${Math.abs(Number(x.amount)).toLocaleString(undefined,{maximumFractionDigits:2})} ${x.type==="withdrawal"?"USDT":"GPX"}</strong><span class="chev">›</span>
          </button>`).join("") : `<div class="empty">No ${active==="ad"?"ad":active} history yet.</div>`}
        </div></div>${bottom("wallet")}</section>`;

      el.querySelector(".page-back").onclick = () => history.back();
      el.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{active=b.dataset.tab;draw();});
      el.querySelectorAll(".history-row").forEach(b=>b.onclick=()=>{
        const x=all[Number(b.dataset.index)];
        el.innerHTML=`<section class="page"><div class="top"><button class="page-back">‹</button><div class="top-copy"><h1>Transaction Details</h1></div></div><div class="body">${detail(x)}</div>${bottom("wallet")}</section>`;
        el.querySelector("#close-detail")?.addEventListener("click",draw);
        el.querySelector(".page-back").onclick=draw;
      });
    };

    try { all = await api.getHistory(); draw(); }
    catch (e) { el.innerHTML=`<div class="loading">Unable to load history.</div>`; fail(e); }
  }
};