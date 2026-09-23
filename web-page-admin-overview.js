import { api } from "./web-api.js";
import { esc, money } from "./web-utils.js";

export default {
  async render(el) {
    const s = await api.admin.overview();
    const cards = [
      ["Users", s.users],
      ["New (24h)", s.new_today],
      ["Active (24h)", s.active_today],
      ["Total GPX balances", Number(s.total_balance).toLocaleString()+" GPX"],
      ["Referrals joined", s.referrals],
      ["Referrals pending", s.pending_referrals],
      ["Required channels", s.channels],
      ["Active tasks", s.active_tasks],
      ["Pending withdrawals", s.pending_withdrawals],
      ["Payouts to check", s.review_withdrawals],
      ["Pending USDT", Number(s.pending_amount).toFixed(2)+" USDT"],
      ["Paid out", Number(s.paid_out).toFixed(2)+" USDT"]
    ];
    el.innerHTML = `<div class="stat">${cards.map(([label, value]) =>
      `<div class="card"><b>${esc(value)}</b><small>${esc(label)}</small></div>`).join("")}</div>`;
  }
};
