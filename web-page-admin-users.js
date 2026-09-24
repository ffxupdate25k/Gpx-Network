// Find a user and add or remove balance.
import { api } from "./web-api.js";
import { notify, haptic, confirmBox } from "./web-telegram.js";
import { esc, money, fmtDate, fail, shortAddr } from "./web-utils.js";

export default {
  async render(el) {
    let lastQuery = "";

    async function search(q) {
      lastQuery = q;
      const list = await api.admin.users(q);
      const box = el.querySelector("#results");
      box.innerHTML = list.length ? list.map((u) => `
        <div class="card">
          <div class="head" style="display:flex;justify-content:space-between;gap:8px">
            <b>${esc(u.name)}</b><b style="color:var(--blue)">${Number(u.balance).toLocaleString()+" GPX"}</b>
          </div>
          <div class="hint">${u.username ? "@" + esc(u.username) + " · " : ""}ID ${esc(u.id)} · ${u.referrals} referrals</div>
          <div class="hint">Wallet: ${u.wallet_address ? esc(shortAddr(u.wallet_address)) : "not saved"} · ${u.banned ? '<span class="badge b-err">BANNED</span> · ' : ''}Level ${Number(u.level_override ?? Math.floor(Number(u.referrals)/100))}${u.is_admin ? ' · ADMIN' : ''} · Joined ${esc(fmtDate(u.created_at))}</div>
          <div class="acts"><button class="btn sm ghost" data-id="${u.id}">Open</button></div>
        </div>`).join("") : `<div class="card empty">No users found.</div>`;

      box.querySelectorAll("[data-id]").forEach((b) => {
        b.onclick = () => showUser(list.find((u) => String(u.id) === b.dataset.id));
      });
    }

    function showUser(u) {
      let balance = u.balance;
      el.innerHTML = `
        <div class="card">
          <b>${esc(u.name)}</b>
          <div class="hint">${u.username ? "@" + esc(u.username) + " · " : ""}ID ${esc(u.id)}</div>
          <div class="row"><span class="l">Balance</span><span class="r" id="bal">${Number(balance).toLocaleString()+" GPX"}</span></div>
          <div class="row"><span class="l">Wallet</span><span class="r mono" style="font-size:12px">${u.wallet_address ? esc(u.wallet_address) : "Not saved"}</span></div>
          <label for="u-level">User level</label><input id="u-level" type="number" min="0" max="1000" value="${Number(u.level_override ?? Math.floor(Number(u.referrals)/100))}">
          <div class="acts"><button class="btn sm ghost" id="save-level">Save Level</button>${u.is_admin ? `<button class="btn sm danger" id="remove-admin">Remove Admin</button>` : `<button class="btn sm" id="make-admin">Make Admin</button>`}</div>
          ${u.wallet_address ? `<div class="acts" style="margin-top:0"><button class="btn sm danger" id="reset">Reset wallet</button></div><p class="hint">Resetting lets this user save a different wallet.</p>` : ""}
          <div class="acts" style="margin-top:8px"><button class="btn sm ${u.banned?'':'danger'}" id="ban">${u.banned?'Unban User':'Ban User'}</button></div>
          <label for="a-amt">Amount (USD)</label>
          <input id="a-amt" type="number" inputmode="decimal" step="any" placeholder="0.00">
          <label for="a-note">Note (optional, shown in their history)</label>
          <input id="a-note" maxlength="80" placeholder="e.g. Contest prize">
          <div class="gap" style="height:16px"></div>
          <div class="acts" style="margin-top:0">
            <button class="btn" id="add" style="flex:1">Add</button>
            <button class="btn danger" id="remove" style="flex:1">Remove</button>
          </div>
          <div class="gap"></div>
          <button class="btn ghost" id="back">Back to search</button>
        </div>`;

      async function apply(sign, btn) {
        const amount = parseFloat(el.querySelector("#a-amt").value);
        if (!amount || amount <= 0) { haptic("error"); return notify("Enter an amount greater than 0."); }
        btn.disabled = true;
        try {
          const r = await api.admin.adjustBalance(u.id, sign * amount, el.querySelector("#a-note").value);
          balance = r.balance;
          u.balance = balance;
          el.querySelector("#bal").textContent = Number(balance).toLocaleString()+" GPX";
          el.querySelector("#a-amt").value = "";
          haptic("success");
          notify((sign > 0 ? "Added. " : "Removed. ") + "New balance: " + Number(balance).toLocaleString()+" GPX");
        } catch (err) { fail(err); }
        btn.disabled = false;
      }

      el.querySelector("#save-level").onclick=async()=>{try{const level=Number(el.querySelector("#u-level").value);await api.admin.setLevel(u.id,level);notify("User level updated.");haptic("success");}catch(err){fail(err)}};
      const adminBtn=el.querySelector("#make-admin");
      if(adminBtn) adminBtn.onclick=async()=>{try{await api.admin.addAdmin(u.id);notify("User is now an admin.");haptic("success");showUser({...u,is_admin:true});}catch(err){fail(err)}};
      const removeAdmin=el.querySelector("#remove-admin");
      if(removeAdmin) removeAdmin.onclick=async()=>{if(!(await confirmBox("Remove admin access from this user?")))return;try{await api.admin.removeAdmin(u.id);notify("Admin access removed.");haptic("success");showUser({...u,is_admin:false});}catch(err){fail(err)}};

      const banBtn=el.querySelector('#ban');
      if(banBtn) banBtn.onclick=async()=>{const next=!u.banned;if(!next && !(await confirmBox('Unban this user?')))return;if(next && !(await confirmBox('Ban this user account? They will be blocked from the Mini App.')))return;try{await api.admin.banUser(u.id,next);u.banned=next;notify(next?'User banned.':'User unbanned.');haptic('success');showUser(u);}catch(err){fail(err)}};

      const reset = el.querySelector("#reset");
      if (reset) {
        reset.onclick = async () => {
          if (!(await confirmBox("Let this user save a different wallet?"))) return;
          try {
            await api.admin.resetWallet(u.id);
            u.wallet_address = null;
            haptic("success");
            notify("Wallet reset.");
            showUser(u);
          } catch (err) { fail(err); }
        };
      }
      el.querySelector("#add").onclick = (e) => apply(1, e.currentTarget);
      el.querySelector("#remove").onclick = (e) => apply(-1, e.currentTarget);
      el.querySelector("#back").onclick = () => drawSearch();
    }

    function drawSearch() {
      el.innerHTML = `
        <div class="card">
          <input id="q" type="search" placeholder="Search by Telegram ID or @username" value="${esc(lastQuery)}">
          <div class="gap"></div>
          <button class="btn" id="go">Search</button>
        </div>
        <div id="results"></div>`;
      const run = () => search(el.querySelector("#q").value.trim()).catch(fail);
      el.querySelector("#go").onclick = run;
      el.querySelector("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
      run();
    }
    drawSearch();
  }
};
