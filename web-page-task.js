import { api } from "./web-api.js";
import { tap, haptic, notify, openAny } from "./web-telegram.js";
import { esc, pageTop, fail } from "./web-utils.js";
import { emitActivity } from "./web-live.js";

// Tasks are grouped into phases the user works through in this order. The category
// itself is decided by the server (srv-services.js categorizeTask) from each task's
// link — this file only ever displays it.
const PHASES = [
  { id: "telegram", label: "Telegram" },
  { id: "telegram_bot", label: "Telegram Bot" },
  { id: "external", label: "External Link" }
];
const phaseLabel = (id) => (PHASES.find((p) => p.id === id) || PHASES[2]).label;

// Active countdown timers, keyed by task id, so a re-render or reload never leaves two
// timers running for the same task.
const timers = new Map();
function stopTimer(id) {
  const t = timers.get(id);
  if (t) { clearInterval(t); timers.delete(id); }
}

function actionsHTML(t) {
  if (t.status === "done") return `<span class="badge b-ok">Done</span>`;
  if (t.status === "pending") {
    if (t.verify_type === "timer") return `<span class="badge b-pend" id="cd-${t.id}">Claiming in ${t.remaining_seconds}s…</span>`;
    return `<span class="badge b-pend">In review</span>`;
  }
  const open = t.url ? `<button class="btn sm ghost" data-act="open" data-id="${t.id}">Open</button>` : "";
  if (t.verify_type === "auto") return open + `<button class="btn sm" data-act="verify" data-id="${t.id}">Verify</button>`;
  return `<button class="btn sm" data-act="start" data-id="${t.id}">Start task</button>`;
}

function rowHTML(t) {
  return `
    <div class="task">
      <div class="head"><b>${esc(t.title)}</b><span class="reward">+${Number(t.reward).toLocaleString() + " GPX"}</span></div>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ""}
      <div class="acts">${actionsHTML(t)}</div>
    </div>`;
}

export default {
  async render(el, { go }) {
    let tasks = await api.getTasks();
    let active = null; // decided once tasks are in, by pickPhase()

    const byPhase = (id) => tasks.filter((t) => t.category === id);
    const isPhaseCleared = (id) => { const l = byPhase(id); return l.length > 0 && l.every((t) => t.status === "done"); };
    const hasOpenTask = (id) => byPhase(id).some((t) => t.status !== "done");

    // First phase (in PHASES order) that still has something to do; if everything
    // everywhere is done, land on the last phase that actually has tasks so the
    // user sees a completed list rather than an empty one.
    const pickPhase = () => {
      const withOpen = PHASES.find((p) => hasOpenTask(p.id));
      if (withOpen) return withOpen.id;
      const withAny = [...PHASES].reverse().find((p) => byPhase(p.id).length > 0);
      return withAny ? withAny.id : PHASES[0].id;
    };
    active = pickPhase();

    el.innerHTML = `
      <section class="page">
        ${pageTop("Task", "Complete tasks to earn rewards")}
        <div class="body">
          <div class="tabs" id="phase-tabs"></div>
          <div id="phase-banner"></div>
          <div class="card" id="list"></div>
        </div>
      </section>`;
    const list = el.querySelector("#list");
    const tabsBox = el.querySelector("#phase-tabs");
    const banner = el.querySelector("#phase-banner");

    const drawTabs = () => {
      tabsBox.innerHTML = PHASES.map((p) => {
        const l = byPhase(p.id);
        const count = l.length ? ` (${l.filter((t) => t.status === "done").length}/${l.length})` : "";
        return `<button class="tab ${p.id === active ? "on" : ""}" data-phase="${p.id}">${esc(p.label)}${count}</button>`;
      }).join("");
      tabsBox.querySelectorAll("[data-phase]").forEach((b) => b.onclick = () => {
        if (b.dataset.phase === active) return;
        tap(); active = b.dataset.phase; draw();
      });
    };

    // Once every task the user has is done, the list itself has nothing left to show —
    // swap it for a completion message and a nudge to create their own campaign instead
    // of leaving a page full of "Done" rows.
    const allDone = () => tasks.length > 0 && tasks.every((t) => t.status === "done");

    const draw = () => {
      if (allDone()) {
        tabsBox.innerHTML = "";
        list.innerHTML = `
          <div class="empty alldone">
            <div class="alldone-ic">🎉</div>
            <b>You've completed all tasks!</b>
            <p>Nice work — you're all caught up for now. Want to keep earning? Create your own campaign and let other users complete tasks for you.</p>
            <button class="btn" id="own-campaign-btn">🚀 Create Campaign</button>
          </div>`;
        const ownBtn = list.querySelector("#own-campaign-btn");
        if (ownBtn) ownBtn.onclick = () => { tap(); go("campaign"); };
        return;
      }
      drawTabs();
      // Completed tasks disappear from the list entirely instead of sitting there as "Done".
      const rows = byPhase(active).filter((t) => t.status !== "done");
      list.innerHTML = rows.length ? rows.map(rowHTML).join("") : `<div class="empty">No ${esc(phaseLabel(active))} tasks right now.<br>Check back soon.</div>`;
      rows.filter((t) => t.status === "pending" && t.verify_type === "timer").forEach(startCountdown);
    };
    const reload = async () => { tasks.forEach((t) => stopTimer(t.id)); tasks = await api.getTasks(); };
    draw();

    // Once a phase's last task is completed, tell the user and move them into the
    // next phase (in Telegram → Telegram Bot → External Link order) that still has
    // something to do.
    const advanceIfPhaseCleared = () => {
      if (!isPhaseCleared(active)) return;
      const currentIndex = PHASES.findIndex((p) => p.id === active);
      const next = PHASES.slice(currentIndex + 1).find((p) => hasOpenTask(p.id));
      if (!next) return;
      banner.innerHTML = `<div class="info">🎉 ${esc(phaseLabel(active))} tasks complete! Moving to next task phase…</div>`;
      haptic("success");
      setTimeout(() => { banner.innerHTML = ""; active = next.id; draw(); }, 1400);
    };

    // Ticks a task's badge down to 0, then claims the reward automatically.
    function startCountdown(t) {
      stopTimer(t.id);
      let remaining = t.remaining_seconds;
      const badge = () => list.querySelector(`#cd-${t.id}`);
      timers.set(t.id, setInterval(async () => {
        remaining -= 1;
        const el2 = badge();
        if (remaining > 0) {
          if (el2) el2.textContent = `Claiming in ${remaining}s…`;
          return;
        }
        stopTimer(t.id);
        if (el2) el2.textContent = "Claiming…";
        try {
          const r = await api.claimTask(t.id);
          haptic("success");
          notify(`Task complete! You earned ${Number(r.reward).toLocaleString() + " GPX"}.`);
          emitActivity({ type: "task", reward: r.reward });
          await reload();
          draw();
          advanceIfPhaseCleared();
        } catch (err) {
          fail(err);
          await reload();
          draw(); // pull fresh state (and a corrected remaining_seconds) rather than getting stuck
        }
      }, 1000));
    }

    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const task = tasks.find((x) => x.id === id);
      if (!task) return;
      tap();
      try {
        if (btn.dataset.act === "open") return openAny(task.url);

        if (btn.dataset.act === "verify") {
          btn.disabled = true;
          const r = await api.claimTask(id);
          haptic("success");
          notify(`Task complete! You earned ${Number(r.reward).toLocaleString() + " GPX"}.`);
          emitActivity({ type: "task", reward: r.reward });
          await reload();
          draw();
          return advanceIfPhaseCleared();
        }

        if (btn.dataset.act === "start") {
          btn.disabled = true;
          if (task.url) openAny(task.url);
          const r = await api.startTask(id);
          task.status = "pending";
          task.remaining_seconds = r.remaining_seconds;
          draw();
        }
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    });
  }
};
