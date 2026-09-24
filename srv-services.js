// Business logic. Every money movement happens inside a database transaction.
const { pool, tx, getSettings } = require('./srv-db');
const tgApi = require('./srv-telegram');
const { ADMIN_IDS } = require('./srv-config');
const { HttpError } = require('./srv-errors');
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function money(n) {
  const v = Number(n);
  const two = v.toFixed(2);
  return '$' + (Number(two) === v ? two : v.toFixed(4).replace(/0+$/, ''));
}

function displayName(u) {
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return full || (u.username ? '@' + u.username : 'User ' + u.id);
}

function renderReferralMessage(template, data) {
  const values = {
    name: data.name || 'User',
    username: data.username || 'No username',
    first_name: data.first_name || '',
    last_name: data.last_name || '',
    user_id: String(data.user_id ?? ''),
    reward: Number(data.reward || 0).toLocaleString(),
    referrals: Number(data.referrals || 0).toLocaleString(),
    level: String(data.level ?? 0),
    date: data.date || new Date().toLocaleString(),
    milestone: data.milestone || 'Keep inviting friends to unlock more rewards.'
  };
  return String(template || '').replace(/\{\{?\s*([a-z_]+)\s*\}?\}/gi, (all, key) =>
    Object.prototype.hasOwnProperty.call(values, key.toLowerCase()) ? values[key.toLowerCase()] : all
  );
}

// ---------- Messaging ----------
// Operational events stay inside the Mini App. The bot does not send automatic
// referral, task, withdrawal or payout notifications. Admin broadcasts are separate
// and are sent only when an admin explicitly starts one.
async function notifyUser(userId, text, extra = {}) {
  try {
    const r = await pool.query('SELECT notifications_enabled, bot_blocked FROM users WHERE id=$1',[userId]);
    if (!r.rowCount || !r.rows[0].notifications_enabled || r.rows[0].bot_blocked) return false;
    await tgApi.sendMessage(userId, String(text).slice(0,3900), extra);
    return true;
  } catch(e) { console.error('notifyUser:',e.message); return false; }
}
async function notifyAdmins(text) {
  for (const id of ADMIN_IDS) { try { await tgApi.sendMessage(id, String(text).slice(0,3900)); } catch(e){} }
}

// ---------- Users and referrals ----------
async function registerUser(u, refId) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, first_name, last_name, username, language_code, photo_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       username = EXCLUDED.username,
       language_code = EXCLUDED.language_code,
       photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
       last_seen = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [u.id, u.first_name || null, u.last_name || null, u.username || null, u.language_code || null, u.photo_url || null]
  );
  const user = rows[0];
  // A referral is only saved for brand-new users, and never for yourself.
  if (user.inserted && refId && Number(refId) !== Number(user.id)) {
    await createPendingReferral(user, Number(refId));
  }
  return user;
}

// Saved when a new user sends /start (or opens the app) with a referral link. No money moves yet.
async function createPendingReferral(user, referrerId) {
  let reward = 0;
  try {
    const ok = await tx(async (c) => {
      const ref = await c.query('SELECT id FROM users WHERE id = $1', [referrerId]);
      if (!ref.rowCount) return false;
      reward = (await getSettings(c)).referral_reward;
      await c.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrerId, user.id]);
      await c.query(
        `INSERT INTO referrals (referred_id, referrer_id, reward, status) VALUES ($1, $2, 0, 'pending')`,
        [user.id, referrerId]
      );
      return true;
    });
    if (!ok) return;
  } catch (e) {
    console.error('Could not save referral:', e.message);
    return;
  }
}

// Pays the referrer. Called when the referred user passes the channel gate. Safe to call many times.
async function completeReferral(userId) {
  let done = null;
  try {
    done = await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT referrer_id FROM referrals WHERE referred_id = $1 AND status = 'pending' FOR UPDATE`,
        [userId]
      );
      if (!rows.length) return null;
      const referrerId = rows[0].referrer_id;
      const reward = (await getSettings(c)).referral_reward;
      const u = await c.query('SELECT id, first_name, last_name, username FROM users WHERE id = $1', [userId]);
      const referredUser = u.rows[0];
      const name = displayName(referredUser);
      await c.query(
        `UPDATE referrals SET status = 'completed', reward = $2, completed_at = now() WHERE referred_id = $1`,
        [userId, reward]
      );
      if (reward > 0) {
        await c.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [reward, referrerId]);
        await c.query(`INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'referral', $3)`,[referrerId,reward,'Referral: '+name]);
      }
      const cntQ=await c.query(`SELECT COUNT(*) AS n FROM referrals WHERE referrer_id=$1 AND status='completed'`,[referrerId]);
      const count=Number(cntQ.rows[0].n); const milestones=(await getSettings(c)).referral_milestones||[]; const awarded=[];
      for(const m of milestones){ const mr=Number(m.referrals), rw=Number(m.reward||0); if(mr>0&&count>=mr){ const ins=await c.query(`INSERT INTO referral_milestone_claims(user_id,milestone_referrals,reward) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[referrerId,mr,rw]); if(ins.rowCount&&rw>0){await c.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[rw,referrerId]);await c.query(`INSERT INTO transactions(user_id,amount,type,title) VALUES($1,$2,'milestone',$3)`,[referrerId,rw,`Referral milestone: ${mr} referrals`]);awarded.push({referrals:mr,reward:rw});}} }
      return {
        referrerId, reward, name,
        username: referredUser.username ? '@' + referredUser.username : 'No username',
        first_name: referredUser.first_name || '',
        last_name: referredUser.last_name || '',
        referredUserId: userId,
        count, awarded
      };
    });
  } catch (e) {
    console.error('Referral completion failed:', e.message);
    return;
  }
  if (done) {
    const settings = await getSettings();
    const milestone = done.awarded && done.awarded.length
      ? '🏆 Milestone unlocked: ' + done.awarded.map(x => `${x.referrals} referrals (+${x.reward} GPX)`).join(', ')
      : '';
    const message = renderReferralMessage(settings.referral_reward_message, {
      name: done.name,
      username: done.username,
      first_name: done.first_name,
      last_name: done.last_name,
      user_id: done.referredUserId,
      reward: done.reward,
      referrals: done.count,
      level: Math.floor(done.count / 100),
      date: new Date().toLocaleString(),
      milestone
    });
    notifyUser(done.referrerId, message);
  }
}

// ---------- Required-channel gate ----------
const GATE_TTL_MS = 10 * 60 * 1000; // a passed check is trusted this long before re-checking
const gatePass = new Map(); // userId -> time until which the pass is trusted

const isMember = (m) =>
  ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member === true);

function clearGateCache() { gatePass.clear(); }

async function checkGate(userId, { force = false } = {}) {
  if (!force) {
    const until = gatePass.get(userId);
    if (until && until > Date.now()) return { passed: true, channels: [] };
  }

  const { rows } = await pool.query('SELECT id, title, chat_id, url FROM channels WHERE active ORDER BY id');
  const channels = await Promise.all(rows.map(async (ch) => {
    let joined = false;
    let error = false;
    try {
      joined = isMember(await tgApi.getChatMember(ch.chat_id, userId));
    } catch (e) {
      error = true;
      console.error(`Gate check failed for channel ${ch.id} (${ch.chat_id}):`, e.message);
    }
    return { id: ch.id, title: ch.title, url: ch.url, joined, error };
  }));

  const passed = channels.every((c) => c.joined);
  if (passed) {
    if (gatePass.size > 20000) {
      const now = Date.now();
      for (const [k, v] of gatePass) if (v < now) gatePass.delete(k);
    }
    gatePass.set(userId, Date.now() + GATE_TTL_MS);
    await completeReferral(userId); // the referrer is paid the moment the user gets through
  } else {
    gatePass.delete(userId);
  }
  return { passed, channels };
}

// ---------- Tasks ----------
async function lockTaskForCompletion(c, taskId) {
  const q = await c.query('SELECT * FROM tasks WHERE id=$1 AND active FOR UPDATE', [taskId]);
  if (!q.rowCount) throw new HttpError(404, 'Task is no longer available.');
  const current = q.rows[0];
  const completedQ = await c.query(
    `SELECT COUNT(*) AS n FROM task_submissions WHERE task_id=$1 AND status='approved'`,
    [taskId]
  );
  const completed = Number(completedQ.rows[0].n || 0);
  if (Number(current.max_completions || 0) > 0 && completed >= Number(current.max_completions)) {
    await c.query('DELETE FROM tasks WHERE id=$1', [taskId]);
    throw new HttpError(404, 'This task has reached its completion limit.');
  }
  return { task: current, completed };
}

async function finishTaskReward(c, task, userId, submissionId) {
  if (submissionId) {
    await c.query(
      `UPDATE task_submissions SET status='approved', reviewed_at=now() WHERE id=$1`,
      [submissionId]
    );
  } else {
    try {
      await c.query(
        `INSERT INTO task_submissions (task_id, user_id, status, reviewed_at)
         VALUES ($1, $2, 'approved', now())`,
        [task.id, userId]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'You already completed this task.');
      throw e;
    }
  }

  const r = await c.query(
    'UPDATE users SET balance=balance+$1 WHERE id=$2 RETURNING balance',
    [task.reward, userId]
  );
  await c.query(
    `INSERT INTO transactions (user_id, amount, type, title)
     VALUES ($1, $2, 'task', $3)`,
    [userId, task.reward, 'Task: ' + task.title]
  );

  const countQ = await c.query(
    `SELECT COUNT(*) AS n FROM task_submissions WHERE task_id=$1 AND status='approved'`,
    [task.id]
  );
  const completed = Number(countQ.rows[0].n || 0);
  const limit = Number(task.max_completions || 0);

  if (limit > 0 && completed >= limit) {
    await c.query('DELETE FROM tasks WHERE id=$1', [task.id]);
  }

  return r.rows[0].balance;
}

async function completeAutoTask(task, userId) {
  return tx(async (c) => {
    const locked = await lockTaskForCompletion(c, task.id);
    return finishTaskReward(c, locked.task, userId, null);
  });
}

// Timer tasks: starting records when the countdown began; completion checks the server clock.
async function startTimerTask(task, userId) {
  const existing = await pool.query(
    `SELECT created_at FROM task_submissions
      WHERE task_id=$1 AND user_id=$2 AND status IN ('pending','approved')`,
    [task.id, userId]
  );
  if (existing.rowCount) return existing.rows[0].created_at;

  // Check the limit before creating a pending progress record.
  const limitQ = await pool.query(
    `SELECT t.max_completions,
            (SELECT COUNT(*) FROM task_submissions s WHERE s.task_id=t.id AND s.status='approved') AS completed
       FROM tasks t WHERE t.id=$1 AND t.active`,
    [task.id]
  );
  if (!limitQ.rowCount) throw new HttpError(404, 'Task is no longer available.');
  const limit = Number(limitQ.rows[0].max_completions || 0);
  const completed = Number(limitQ.rows[0].completed || 0);
  if (limit > 0 && completed >= limit) {
    await pool.query('DELETE FROM tasks WHERE id=$1', [task.id]);
    throw new HttpError(404, 'This task has reached its completion limit.');
  }

  try {
    const r = await pool.query(
      `INSERT INTO task_submissions (task_id,user_id,status)
       VALUES ($1,$2,'pending') RETURNING created_at`,
      [task.id,userId]
    );
    return r.rows[0].created_at;
  } catch (e) {
    if (e.code === '23505') {
      const again = await pool.query(
        `SELECT created_at FROM task_submissions
          WHERE task_id=$1 AND user_id=$2 AND status IN ('pending','approved')`,
        [task.id,userId]
      );
      if (again.rowCount) return again.rows[0].created_at;
    }
    throw e;
  }
}

async function completeTimerTask(task, userId) {
  return tx(async (c) => {
    const locked = await lockTaskForCompletion(c, task.id);
    const currentTask = locked.task;

    const { rows } = await c.query(
      `SELECT id, created_at FROM task_submissions
        WHERE task_id=$1 AND user_id=$2 AND status='pending'
        FOR UPDATE`,
      [task.id,userId]
    );
    if (!rows.length) throw new HttpError(400, 'Open the task first, then wait for the countdown.');

    const waitedSec = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
    if (waitedSec + 1 < Number(currentTask.timer_seconds)) {
      throw new HttpError(400, `Please wait ${Math.ceil(Number(currentTask.timer_seconds) - waitedSec)} more second(s).`);
    }

    return finishTaskReward(c, currentTask, userId, rows[0].id);
  });
}


// ---------- Monetag rewarded ads ----------
async function adStatus(userId) {
  const s = await getSettings();
  const r = await pool.query(`
    SELECT ads_watch_date, ads_watched_today,
           COALESCE((SELECT COUNT(*) FROM task_submissions ts
                     WHERE ts.user_id=u.id AND ts.status='approved'
                       AND ts.reviewed_at >= date_trunc('day', now())),0) AS tasks_today
      FROM users u WHERE u.id=$1`, [userId]);
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  const row = r.rows[0];
  let watched = Number(row.ads_watched_today || 0);
  if (row.ads_watch_date && new Date(row.ads_watch_date).toISOString().slice(0,10) !== new Date().toISOString().slice(0,10)) watched = 0;
  if (!row.ads_watch_date) watched = 0;
  return {
    watched_today: watched,
    max_ads_per_day: Math.max(0, Number(s.max_ads_per_day || 0)),
    reward_gpx: Math.max(0, Number(s.ad_reward_gpx || 0)),
    remaining: Math.max(0, Number(s.max_ads_per_day || 0) - watched),
    tasks_today: Number(row.tasks_today || 0),
    required_ads_before_withdrawal: Math.max(0, Number(s.required_ads_before_withdrawal || 0)),
    required_tasks_before_withdrawal: Math.max(0, Number(s.required_tasks_before_withdrawal || 0)),
    monetag_zone_id: String(s.monetag_zone_id || '11878092'), monetag_sdk_src: String(s.monetag_sdk_src || '')
  };
}

async function startAd(userId) {
  const s = await getSettings();
  const max = Math.max(0, Number(s.max_ads_per_day || 0));
  const nonce = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(nonce).digest('hex');
  const today = new Date().toISOString().slice(0,10);
  return tx(async (c) => {
    const r = await c.query(`SELECT ads_watch_date,ads_watched_today FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (!r.rowCount) throw new HttpError(404, 'User not found.');
    let watched = Number(r.rows[0].ads_watched_today || 0);
    if (!r.rows[0].ads_watch_date || new Date(r.rows[0].ads_watch_date).toISOString().slice(0,10) !== today) {
      watched = 0;
      await c.query(`UPDATE users SET ads_watch_date=$1,ads_watched_today=0 WHERE id=$2`, [today,userId]);
    }
    if (max > 0 && watched >= max) throw new HttpError(400, `You have reached today's ${max} ad limit. Come back tomorrow.`);
    await c.query(`DELETE FROM ad_claims WHERE user_id=$1 AND (expires_at < now() OR used_at IS NOT NULL)`, [userId]);
    await c.query(`INSERT INTO ad_claims(user_id,nonce_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')`, [userId,hash]);
    return { nonce, reward_gpx: Math.max(0,Number(s.ad_reward_gpx||0)), watched_today: watched, remaining: Math.max(0,max-watched) };
  });
}

async function rewardAd(userId, nonce) {
  const s = await getSettings();
  const hash = crypto.createHash('sha256').update(String(nonce || '')).digest('hex');
  const reward = Math.max(0, Number(s.ad_reward_gpx || 0));
  const max = Math.max(0, Number(s.max_ads_per_day || 0));
  return tx(async (c) => {
    const claim = await c.query(`SELECT id FROM ad_claims WHERE user_id=$1 AND nonce_hash=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE`, [userId,hash]);
    if (!claim.rowCount) throw new HttpError(400, 'This ad session is invalid or has expired. Please start another ad.');
    const r = await c.query(`SELECT ads_watch_date,ads_watched_today FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (!r.rowCount) throw new HttpError(404,'User not found.');
    const today = new Date().toISOString().slice(0,10);
    let watched = Number(r.rows[0].ads_watched_today || 0);
    if (!r.rows[0].ads_watch_date || new Date(r.rows[0].ads_watch_date).toISOString().slice(0,10) !== today) watched = 0;
    if (max > 0 && watched >= max) throw new HttpError(400, `You have reached today's ${max} ad limit.`);
    await c.query(`UPDATE ad_claims SET used_at=now() WHERE id=$1`, [claim.rows[0].id]);
    const u = await c.query(`UPDATE users SET ads_watch_date=$1,ads_watched_today=$2,balance=balance+$3 WHERE id=$4 RETURNING balance,ads_watched_today`, [today,watched+1,reward,userId]);
    if (reward > 0) await c.query(`INSERT INTO transactions(user_id,amount,type,title) VALUES($1,$2,'ad',$3)`, [userId,reward,'Monetag Ad Reward']);
    return { reward, balance:Number(u.rows[0].balance), watched_today:Number(u.rows[0].ads_watched_today), remaining:Math.max(0,max-(watched+1)) };
  });
}

// ---------- Withdrawals and automatic payout ----------
const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');

const autoPayoutReady = (s) =>
  !!(s.auto_payout && s.payout_api_key && s.payout_token_address && s.payout_api_url);

async function createWithdrawal(user, amountIn) {
  const s = await getSettings();
  const address = user.wallet_address;
  if (!address) throw new HttpError(400, 'Connect your USDT BEP20 payout wallet first.');
  const amount = Math.round(Number(amountIn) * 1000000) / 1000000;
  if (!(amount > 0)) throw new HttpError(400, 'Enter a valid USDT amount.');
  if (amount < s.min_withdraw) throw new HttpError(400, `Minimum withdrawal is ${s.min_withdraw.toFixed(2)} USDT.`);
  if (s.max_withdraw > 0 && amount > s.max_withdraw) throw new HttpError(400, `Maximum withdrawal is ${s.max_withdraw.toFixed(2)} USDT.`);
  const fee = Math.round(Number(s.withdrawal_fee || 0) * 1000000) / 1000000;
  if (fee >= amount) throw new HttpError(400, `Withdrawal fee is ${fee.toFixed(2)} USDT. Enter an amount higher than the fee.`);
  const payoutAmount = Math.round((amount - fee) * 1000000) / 1000000;
  const todayQ = await pool.query(`
    SELECT
      CASE
        WHEN ads_watch_date = CURRENT_DATE THEN COALESCE(ads_watched_today,0)
        ELSE 0
      END AS ads_watched_today,
      COALESCE((SELECT COUNT(*) FROM task_submissions ts WHERE ts.user_id=$1 AND ts.status='approved'
                AND ts.reviewed_at >= date_trunc('day',now())),0) AS tasks_today,
      (SELECT last_withdrawal_at FROM users WHERE id=$1) AS last_withdrawal_at
    FROM users WHERE id=$1
  `, [user.id]);
  const gate = todayQ.rows[0] || {};
  const watchedAds = Number(gate.ads_watched_today || 0);
  const tasksToday = Number(gate.tasks_today || 0);
  const requiredAds = Math.max(0, Number(s.required_ads_before_withdrawal || 0));
  const requiredTasks = Math.max(0, Number(s.required_tasks_before_withdrawal || 0));
  if (requiredAds > 0 && watchedAds < requiredAds) throw new HttpError(400, `Watch ${requiredAds - watchedAds} more ad(s) before withdrawing.`);
  if (requiredTasks > 0 && tasksToday < requiredTasks) throw new HttpError(400, `Complete ${requiredTasks - tasksToday} more task(s) before withdrawing.`);
  const cooldown = Math.max(0, Number(s.withdrawal_cooldown_hours || 0));
  if (cooldown > 0 && gate.last_withdrawal_at) {
    const elapsedHours = (Date.now() - new Date(gate.last_withdrawal_at).getTime()) / 3600000;
    if (elapsedHours < cooldown) {
      const remain = Math.ceil((cooldown - elapsedHours) * 60);
      throw new HttpError(400, `Withdrawal cooldown active. Try again in ${Math.floor(remain/60)}h ${remain%60}m.`);
    }
  }
  const countQ = await pool.query(`SELECT COUNT(*) AS n FROM withdrawals WHERE user_id=$1 AND created_at>=date_trunc('day',now())`, [user.id]);
  if (Number(countQ.rows[0].n) >= s.withdrawals_per_day) throw new HttpError(400, `You can make only ${s.withdrawals_per_day} withdrawals per day.`);
  const result = await tx(async (c) => {
    const r = await c.query('UPDATE users SET usdt_balance=usdt_balance-$1 WHERE id=$2 AND usdt_balance>=$1 RETURNING usdt_balance', [amount, user.id]);
    if (!r.rowCount) throw new HttpError(400, 'Amount is higher than your USDT balance.');
    const t = await c.query(`INSERT INTO transactions(user_id,amount,type,title,status) VALUES($1,$2,'withdrawal',$3,'pending') RETURNING id`, [user.id, -amount, 'USDT Withdrawal']);
    const w = await c.query(`INSERT INTO withdrawals(user_id,amount,fee,payout_amount,address,transaction_id,payout_state) VALUES($1,$2,$3,$4,$5,$6,'manual') RETURNING id`, [user.id, amount, fee, payoutAmount, address, t.rows[0].id]);
    await c.query(`UPDATE users SET last_withdrawal_at=now() WHERE id=$1`, [user.id]);
    return { id: w.rows[0].id, balance: r.rows[0].usdt_balance };
  });
  notifyAdmins(`💸 New GPX Network withdrawal: ${amount.toFixed(2)} USDT (fee ${fee.toFixed(2)}, send ${payoutAmount.toFixed(2)} USDT) from ${displayName(user)} (ID ${user.id}). Open Admin Panel > Withdrawals to approve or reject it.`);
  return { ...result, auto: false };
}

// Turns the payout service's reply into one of: success, failed (refund), config (admin must fix), uncertain (admin must check).
// The reply format is not known in advance, so this is deliberately defensive.
function classifyPayout(status, text) {
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  const obj = data && typeof data === 'object' ? data : {};
  const inner = obj.data && typeof obj.data === 'object' ? obj.data : {};
  const msg = obj.error || obj.message || obj.detail || inner.error || inner.message;
  const reason = typeof msg === 'string' ? msg : msg ? JSON.stringify(msg) : '';
  const raw = String(text || '').slice(0, 2000);
  const hash = obj.tx_hash || obj.txHash || obj.transaction_hash || obj.transactionHash || obj.hash ||
               inner.tx_hash || inner.txHash || inner.transaction_hash || inner.hash || null;
  const failedFlag =
    obj.success === false || obj.ok === false || !!obj.error ||
    (typeof obj.status === 'string' && /^(error|fail|failed|rejected|insufficient)/i.test(obj.status));

  if (status >= 500) return { kind: 'uncertain', reason: reason || `Payout service error (${status})`, raw };
  if (status === 401 || status === 403 || /api[ _-]?key|unauthori[sz]ed|forbidden/i.test(reason)) {
    return { kind: 'config', reason: reason || 'The payout service rejected the API key.', raw };
  }
  if (/insufficient|not enough|low balance|balance too low|out of funds|no funds/i.test(reason)) {
    return { kind: 'config', reason, raw };
  }
  if (status >= 400 || failedFlag) return { kind: 'failed', reason: reason || `The payout service refused it (${status}).`, raw };
  return { kind: 'success', txHash: hash ? String(hash) : null, raw };
}

async function callPayoutApi(s, w) {
  let res;
  let text = '';
  try {
    res = await fetch(s.payout_api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        api_key: s.payout_api_key,
        to_address: w.address,
        token_address: s.payout_token_address,
        amount: Number(w.payout_amount ?? w.amount)
      }),
      signal: AbortSignal.timeout(90000)
    });
    text = await res.text();
  } catch (e) {
    // We can't know whether the money moved, so never refund automatically here.
    return { kind: 'uncertain', reason: `No clear answer from the payout service (${e.message}).`, raw: '' };
  }
  return classifyPayout(res.status, text);
}


async function notifyPayoutChannel(w, txHash) {
  const s = await getSettings();
  if (!s.payout_channel_enabled || !s.payout_channel) return false;
  const hash = txHash || 'Not returned';
  const text = `New Withdrawal Approved\n\nAmount: ${money(w.payout_amount ?? w.amount)} USDT\nUser ID: ${w.user_id}\nTx hash: ${hash}\nHash: ${hash}\nStatus: Approved`;
  try { await tgApi.sendMessage(s.payout_channel, text); return true; } catch (e) { console.error('payout channel:', e.message); return false; }
}

async function runPayout(id) {
  const s = await getSettings();
  const found = await pool.query(
    `SELECT id, user_id, amount, fee, payout_amount, address, transaction_id FROM withdrawals
      WHERE id = $1 AND status = 'pending' AND payout_state = 'sending'`,
    [id]
  );
  if (!found.rowCount) return;
  const w = found.rows[0];

  if (!autoPayoutReady(s)) {
    await pool.query(`UPDATE withdrawals SET payout_state = 'manual', note = 'Auto payout is not set up.' WHERE id = $1`, [id]);
    notifyAdmins(`⚠️ A withdrawal of ${money(w.amount)} is waiting: auto payout is not set up. Open Admin panel > Settings.`);
    return;
  }

  const r = await callPayoutApi(s, w);
  const amountText = money(w.amount);
  const where = shortAddr(w.address);

  if (r.kind === 'success') {
    await tx(async (c) => {
      const cur = await c.query(`SELECT id FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
      if (!cur.rowCount) return;
      await c.query(
        `UPDATE withdrawals SET status = 'paid', payout_state = 'done', tx_hash = $2, payout_response = $3, processed_at = now() WHERE id = $1`,
        [id, r.txHash, r.raw]
      );
      await c.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [w.transaction_id]);
    });
    const link = r.txHash && /^0x[0-9a-fA-F]{64}$/.test(r.txHash) ? `\nTransaction: https://bscscan.com/tx/${r.txHash}` : '';
    notifyUser(w.user_id, `✅ Your withdrawal of ${amountText} was sent to ${where}.${link}`);
    await notifyPayoutChannel(w, r.txHash);
    return;
  }

  if (r.kind === 'failed') {
    await tx(async (c) => {
      const cur = await c.query(`SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
      if (!cur.rowCount) return;
      await c.query('UPDATE withdrawals SET payout_response = $2 WHERE id = $1', [id, r.raw]);
      await refundWithdrawal(c, cur.rows[0], `Payout failed: ${r.reason}`.slice(0, 300));
    });
    notifyUser(w.user_id, `❌ Your withdrawal of ${amountText} could not be sent (${r.reason}). The amount is back in your balance.`.slice(0, 600));
    notifyAdmins(`⚠️ Payout of ${amountText} to ${where} failed and was refunded to the user. Reason: ${r.reason}`.slice(0, 600));
    return;
  }

  // config or uncertain: keep the money reserved and let the admin decide.
  const state = r.kind === 'config' ? 'manual' : 'review';
  await pool.query(
    `UPDATE withdrawals SET payout_state = $2, note = $3, payout_response = $4 WHERE id = $1 AND status = 'pending'`,
    [id, state, r.reason.slice(0, 300), r.raw]
  );
  notifyUser(w.user_id, `⏳ Your withdrawal of ${amountText} is being processed. You'll get a message when it's done.`);
  notifyAdmins(
    r.kind === 'config'
      ? `⚠️ Auto payout problem: ${r.reason}\nA withdrawal of ${amountText} to ${where} is waiting. Fix Settings, then tap "Send automatically" in Admin panel > Withdrawals.`
      : `⚠️ Unclear payout result for ${amountText} to ${where}: ${r.reason}\nCheck whether it was sent, then mark it paid or reject it (refund) in Admin panel > Withdrawals.`
  );
}

// Admin approval: reserve the request, send through the configured payout API, then mark paid or refund.
async function approveWithdrawal(id, adminId) {
  const claimed = await tx(async (c) => {
    const q = await c.query(`SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
    if (!q.rowCount) throw new HttpError(404, 'Already processed or not found.');
    const row = q.rows[0];
    if (row.payout_state === 'sending') throw new HttpError(409, 'This withdrawal is already being processed.');
    await c.query(`UPDATE withdrawals SET payout_state='sending', note=NULL, processed_by=$2 WHERE id=$1`, [id, adminId]);
    return row;
  });
  const s = await getSettings();
  if (!(s.payout_api_key && s.payout_token_address && s.payout_api_url)) {
    await pool.query(`UPDATE withdrawals SET payout_state='manual', note='Payout service is not configured. Add the payout API URL, API key and token address in Settings.' WHERE id=$1 AND status='pending'`, [id]);
    throw new HttpError(400, 'Payout service is not configured.');
  }
  const r = await callPayoutApi(s, claimed);
  const amountText = money(claimed.amount);
  const where = shortAddr(claimed.address);
  if (r.kind === 'success') {
    await tx(async (c) => {
      const cur = await c.query(`SELECT id FROM withdrawals WHERE id=$1 AND status='pending' FOR UPDATE`, [id]);
      if (!cur.rowCount) return;
      await c.query(`UPDATE withdrawals SET status='paid', payout_state='done', tx_hash=$2, payout_response=$3, processed_at=now(), processed_by=$4 WHERE id=$1`, [id, r.txHash, r.raw, adminId]);
      await c.query(`UPDATE transactions SET status='completed' WHERE id=$1`, [claimed.transaction_id]);
    });
    const link = r.txHash && /^0x[0-9a-fA-F]{64}$/.test(r.txHash) ? `\nTransaction: https://bscscan.com/tx/${r.txHash}` : '';
    notifyUser(claimed.user_id, `✅ Your withdrawal of ${amountText} USDT was approved and sent to ${where}.${r.txHash ? `\nTX Hash: ${r.txHash}` : ''}${link}`.slice(0, 1000));
    await notifyPayoutChannel(claimed, r.txHash);
    return {status:'paid', tx_hash:r.txHash||null};
  }
  if (r.kind === 'failed' || r.kind === 'config') {
    await tx(async (c) => {
      const cur = await c.query(`SELECT * FROM withdrawals WHERE id=$1 AND status='pending' FOR UPDATE`, [id]);
      if (!cur.rowCount) return;
      await c.query(`UPDATE withdrawals SET payout_response=$2 WHERE id=$1`, [id, r.raw]);
      await refundWithdrawal(c, cur.rows[0], `Withdrawal rejected: ${r.reason}`.slice(0,300), adminId);
    });
    notifyUser(claimed.user_id, `❌ Your withdrawal of ${amountText} USDT was rejected. ${r.reason || 'The payout service rejected the request.'} The amount has been refunded to your balance.`.slice(0,900));
    return {status:'rejected', reason:r.reason};
  }
  await pool.query(`UPDATE withdrawals SET payout_state='review', note=$2, payout_response=$3 WHERE id=$1 AND status='pending'`, [id, (r.reason||'Payout result could not be confirmed.').slice(0,300), r.raw]);
  notifyUser(claimed.user_id, `⏳ Your withdrawal of ${amountText} USDT is still processing because the payout service did not return a clear result. An admin will review it.`);
  throw new HttpError(502, 'Payout result could not be confirmed. Review the withdrawal before retrying.');
}

// Retry a withdrawal that was waiting for the admin (auto payout was off, or the API key needed fixing).
async function sendPayoutNow(id) {
  const s = await getSettings();
  if (!autoPayoutReady(s)) {
    throw new HttpError(400, 'Turn on auto payout and add the API key and token address in Settings first.');
  }
  const r = await pool.query(
    `UPDATE withdrawals SET payout_state = 'sending', note = NULL WHERE id = $1 AND status = 'pending' AND payout_state = 'manual' RETURNING id`,
    [id]
  );
  if (!r.rowCount) throw new HttpError(409, 'This withdrawal is not waiting to be sent.');
  runPayout(id).catch((e) => console.error('Payout crashed:', e.message));
}

// If the server restarted while a payout was in flight, we don't know the result: flag it for the admin.
async function recoverPayouts() {
  const r = await pool.query(
    `UPDATE withdrawals SET payout_state = 'review',
            note = 'The server restarted while this payout was being sent. Check whether it went through before deciding.'
      WHERE status = 'pending' AND payout_state = 'sending' RETURNING id`
  );
  if (r.rowCount) {
    notifyAdmins(`⚠️ ${r.rowCount} payout(s) were interrupted by a restart. Check them in Admin panel > Withdrawals before paying or refunding.`);
  }
}

// Manual decision by an admin.
async function processWithdrawal(id, action, adminId) {
  const w = await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
    if (!rows.length) throw new HttpError(404, 'Already processed or not found.');
    const row = rows[0];
    if (row.payout_state === 'sending') throw new HttpError(409, 'This payout is being sent right now. Check again in a minute.');
    if (action === 'paid') {
      await c.query(
        `UPDATE withdrawals SET status = 'paid', payout_state = 'done', processed_at = now(), processed_by = $2 WHERE id = $1`,
        [id, adminId]
      );
      await c.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [row.transaction_id]);
    } else {
      await refundWithdrawal(c, row, 'Rejected by admin', adminId);
    }
    return row;
  });
  notifyUser(
    w.user_id,
    action === 'paid'
      ? `✅ Your withdrawal of ${money(w.amount)} has been paid.`
      : `❌ Your withdrawal of ${money(w.amount)} was rejected. The amount is back in your balance.`
  );
}

// ---------- Admin balance changes ----------
async function adjustBalance(userId, delta, note) {
  return tx(async (c) => {
    const u = await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!u.rowCount) throw new HttpError(404, 'User not found.');
    const r = await c.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= 0 RETURNING balance',
      [delta, userId]
    );
    if (!r.rowCount) throw new HttpError(400, "Balance can't go below zero.");
    const title = note ? 'Admin: ' + note : delta > 0 ? 'Bonus from admin' : 'Balance adjusted by admin';
    await c.query(
      `INSERT INTO transactions (user_id, amount, type, title) VALUES ($1, $2, 'adjustment', $3)`,
      [userId, delta, title]
    );
    return r.rows[0].balance;
  });
}

// ---------- Broadcast ----------
async function runBroadcast(id, text, photoUrl = '', buttons = []) {
  let sent = 0;
  let failed = 0;
  const markup = Array.isArray(buttons) && buttons.length
    ? { reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } }
    : {};

  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE bot_blocked = FALSE');
    await pool.query('UPDATE broadcasts SET total = $1 WHERE id = $2', [rows.length, id]);

    for (const row of rows) {
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          if (photoUrl) {
            await tgApi.sendPhoto(row.id, photoUrl, text, markup);
          } else {
            await tgApi.sendMessage(row.id, text, markup);
          }
          sent++;
          done = true;
        } catch (e) {
          if (e.code === 429 && e.retryAfter) {
            await sleep((e.retryAfter + 1) * 1000);
            continue;
          }
          if (e.code === 403) await pool.query('UPDATE users SET bot_blocked = TRUE WHERE id = $1', [row.id]).catch(() => {});
          failed++;
          done = true;
        }
      }
      if ((sent + failed) % 20 === 0) {
        await pool.query('UPDATE broadcasts SET sent = $1, failed = $2 WHERE id = $3', [sent, failed, id]);
      }
      await sleep(50);
    }
    await pool.query(
      `UPDATE broadcasts SET sent = $1, failed = $2, status = 'done' WHERE id = $3`,
      [sent, failed, id]
    );
  } catch (e) {
    console.error('Broadcast failed:', e.message);
    await pool.query(
      `UPDATE broadcasts SET sent = $1, failed = $2, status = 'error' WHERE id = $3`,
      [sent, failed, id]
    ).catch(() => {});
  }
}
function newWalletAddress(){return '0x'+crypto.randomBytes(20).toString('hex');}
async function ensureGpxWallet(userId){
  const r=await pool.query('SELECT gpx_wallet_address FROM users WHERE id=$1',[userId]);
  if(r.rowCount&&r.rows[0].gpx_wallet_address) return r.rows[0].gpx_wallet_address;
  let addr; for(let i=0;i<5;i++){addr=newWalletAddress();try{const x=await pool.query('UPDATE users SET gpx_wallet_address=$1,gpx_wallet_revoked_at=NULL WHERE id=$2 AND gpx_wallet_address IS NULL RETURNING gpx_wallet_address',[addr,userId]);if(x.rowCount)return addr;}catch(e){if(e.code!=='23505')throw e;}}
  throw new HttpError(500,'Could not generate a wallet.');
}
async function generateGpxWallet(userId){const addr=newWalletAddress();try{const r=await pool.query('UPDATE users SET gpx_wallet_address=$1,gpx_wallet_revoked_at=NULL WHERE id=$2 RETURNING gpx_wallet_address',[addr,userId]);if(!r.rowCount)throw new HttpError(404,'User not found.');return r.rows[0].gpx_wallet_address;}catch(e){if(e.code==='23505')return generateGpxWallet(userId);throw e;}}
async function revokeGpxWallet(userId){const r=await pool.query('UPDATE users SET gpx_wallet_address=NULL,gpx_wallet_revoked_at=now() WHERE id=$1 RETURNING id',[userId]);if(!r.rowCount)throw new HttpError(404,'User not found.');return true;}
async function convertGpx(userId, amount){const s=await getSettings(); const n=Math.floor(Number(amount)); if(!Number.isFinite(n)||n<s.min_conversion_gpx)throw new HttpError(400,`Minimum conversion is ${s.min_conversion_gpx.toLocaleString()} GPX.`); if(n%s.gpx_per_001_usdt!==0)throw new HttpError(400,`Amount must be in ${s.gpx_per_001_usdt.toLocaleString()} GPX increments.`); const usdt=n/s.gpx_per_001_usdt*0.01; return tx(async(c)=>{const r=await c.query('UPDATE users SET balance=balance-$1,usdt_balance=usdt_balance+$2 WHERE id=$3 AND balance>=$1 RETURNING balance,usdt_balance',[n,usdt,userId]);if(!r.rowCount)throw new HttpError(400,'Not enough GPX balance.');await c.query(`INSERT INTO transactions(user_id,amount,type,title) VALUES($1,$2,'conversion',$3)`,[userId,-n,`Converted ${n} GPX to ${usdt.toFixed(2)} USDT`]);return{gpx:n,usdt,balance:r.rows[0].balance,usdt_balance:r.rows[0].usdt_balance};});}
async function transferGpx(fromId,address,amount){const n=Math.floor(Number(amount));if(!Number.isFinite(n)||n<=0)throw new HttpError(400,'Enter a valid GPX amount.');const result=await tx(async(c)=>{const me=await c.query('SELECT id,balance,gpx_wallet_address FROM users WHERE id=$1 FOR UPDATE',[fromId]);if(!me.rowCount)throw new HttpError(404,'User not found.');const levelRow=await c.query(`SELECT level_override,(SELECT COUNT(*) FROM referrals WHERE referrer_id=$1 AND status='completed') AS referrals FROM users WHERE id=$1`,[fromId]); const level=levelRow.rows[0].level_override==null?Math.floor(Number(levelRow.rows[0].referrals)/100):Number(levelRow.rows[0].level_override);if(level<10)throw new HttpError(403,'You must reach Level 10 to transfer GPX.');const to=await c.query('SELECT id,username,first_name,last_name,gpx_wallet_address FROM users WHERE lower(gpx_wallet_address)=lower($1) FOR UPDATE',[String(address||'').trim()]);if(!to.rowCount)throw new HttpError(404,'Recipient GPX wallet was not found.');if(to.rows[0].id===fromId)throw new HttpError(400,'You cannot transfer to your own wallet.');if(!to.rows[0].gpx_wallet_address)throw new HttpError(400,'Recipient wallet is revoked.');const r=await c.query('UPDATE users SET balance=balance-$1 WHERE id=$2 AND balance>=$1 RETURNING balance',[n,fromId]);if(!r.rowCount)throw new HttpError(400,'Not enough GPX balance.');await c.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[n,to.rows[0].id]);await c.query(`INSERT INTO transactions(user_id,amount,type,title) VALUES($1,$2,'transfer','Sent GPX to @'||COALESCE($3,'user'))`,[fromId,-n,to.rows[0].username]);await c.query(`INSERT INTO transactions(user_id,amount,type,title) VALUES($1,$2,'transfer','Received GPX from @'||COALESCE($3,'user'))`,[to.rows[0].id,n, (await c.query('SELECT username FROM users WHERE id=$1',[fromId])).rows[0].username]);return{amount:n,recipient:displayName(to.rows[0]),recipientId:to.rows[0].id,balance:r.rows[0].balance};});const senderQ=await pool.query('SELECT first_name,last_name,username FROM users WHERE id=$1',[fromId]); const sender=senderQ.rows[0]||{}; const senderLabel=sender.username?`@${sender.username}`:displayName({id:fromId,...sender}); notifyUser(result.recipientId,`💚 Incoming GPX Transfer\n\n${senderLabel} sent you ${result.amount.toLocaleString()} GPX via Onchain Transfer.`);return result;}
async function setNotifications(userId,enabled){await pool.query('UPDATE users SET notifications_enabled=$1 WHERE id=$2',[!!enabled,userId]);return !!enabled;}
async function redeemPromo(userId,code){const result=await tx(async(c)=>{const q=await c.query('SELECT * FROM promo_codes WHERE upper(code)=upper($1) AND active FOR UPDATE',[String(code||'').trim()]);if(!q.rowCount)throw new HttpError(404,'Promo code not found.');const p=q.rows[0];if(p.max_uses>0&&p.uses>=p.max_uses)throw new HttpError(400,'This promo code has reached its usage limit.');const used=await c.query('SELECT 1 FROM promo_redemptions WHERE code=$1 AND user_id=$2',[p.code,userId]);if(used.rowCount)throw new HttpError(409,'You already used this promo code.');await c.query('INSERT INTO promo_redemptions(code,user_id) VALUES($1,$2)',[p.code,userId]);await c.query('UPDATE promo_codes SET uses=uses+1 WHERE code=$1',[p.code]);await c.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[p.reward,userId]);await c.query(`INSERT INTO transactions(user_id,amount,type,title) VALUES($1,$2,'promo',$3)`,[userId,p.reward,'Promo code: '+p.code]);return{reward:Number(p.reward)};});return result;}

async function setUserLevel(userId, level) {
  const n = Math.max(0, Math.min(1000, Math.floor(Number(level))));
  if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid level.');
  const r = await pool.query('UPDATE users SET level_override=$1 WHERE id=$2 RETURNING level_override', [n, userId]);
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  return n;
}

async function addAdmin(userId, addedBy) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Enter a valid Telegram user ID.');
  const u = await pool.query('SELECT id FROM users WHERE id=$1', [id]);
  if (!u.rowCount) throw new HttpError(404, 'User must open the Mini App once before being added as an admin.');
  await pool.query('INSERT INTO admin_users(user_id,added_by) VALUES($1,$2) ON CONFLICT (user_id) DO NOTHING', [id, addedBy]);
  return true;
}
async function removeAdmin(userId) {
  const id=Number(userId);
  if (!Number.isInteger(id)||id<=0) throw new HttpError(400,'Invalid Telegram user ID.');
  await pool.query('DELETE FROM admin_users WHERE user_id=$1',[id]);
  return true;
}

async function setUserBanned(userId, banned) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid user ID.');
  if (ADMIN_IDS.includes(id)) throw new HttpError(400, 'The main admin cannot be banned.');
  const r = await pool.query('UPDATE users SET banned=$1 WHERE id=$2 RETURNING banned', [!!banned, id]);
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  if (banned) notifyUser(id, '🚫 Your GPX Network account has been banned. Contact support for assistance.');
  return !!r.rows[0].banned;
}

// ---------- Transaction PIN + Telegram biometric security ----------
function hashPin(pin, saltHex) {
  return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}
function validPin(pin) { return /^\d{4}$/.test(String(pin || '')); }
function verifyPinValue(pin, hash, salt) {
  if (!validPin(pin) || !hash || !salt) return false;
  try {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(hashPin(pin, salt), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}
async function hasPin(userId) {
  const r = await pool.query('SELECT transaction_pin_hash, biometric_token_hash FROM users WHERE id=$1', [userId]);
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  return { has_pin: !!r.rows[0].transaction_pin_hash, has_biometric: !!r.rows[0].biometric_token_hash };
}
async function setTransactionPin(userId, pin, currentPin='') {
  if (!validPin(pin)) throw new HttpError(400, 'Transaction PIN must be exactly 4 digits.');
  const r = await pool.query('SELECT transaction_pin_hash,transaction_pin_salt FROM users WHERE id=$1', [userId]);
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  if (r.rows[0].transaction_pin_hash && !verifyPinValue(currentPin, r.rows[0].transaction_pin_hash, r.rows[0].transaction_pin_salt)) {
    throw new HttpError(403, 'Current transaction PIN is incorrect.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  await pool.query('UPDATE users SET transaction_pin_hash=$1,transaction_pin_salt=$2 WHERE id=$3', [hashPin(pin, salt), salt, userId]);
  return true;
}
async function verifyTransactionPin(userId, pin) {
  const r = await pool.query('SELECT transaction_pin_hash,transaction_pin_salt FROM users WHERE id=$1', [userId]);
  if (!r.rowCount) throw new HttpError(404, 'User not found.');
  if (!r.rows[0].transaction_pin_hash) throw new HttpError(400, 'Set your 4-digit transaction PIN first.');
  if (!verifyPinValue(pin, r.rows[0].transaction_pin_hash, r.rows[0].transaction_pin_salt)) throw new HttpError(403, 'Incorrect transaction PIN.');
  return true;
}
async function registerBiometric(userId, token, pin) {
  if (!token || String(token).length < 8) throw new HttpError(400, 'Biometric verification token is missing.');
  await verifyTransactionPin(userId, pin);
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  await pool.query('UPDATE users SET biometric_token_hash=$1 WHERE id=$2', [hash, userId]);
  return true;
}
async function verifyBiometric(userId, token) {
  if (!token) throw new HttpError(403, 'Biometric verification failed.');
  const r = await pool.query('SELECT biometric_token_hash FROM users WHERE id=$1', [userId]);
  if (!r.rowCount || !r.rows[0].biometric_token_hash) throw new HttpError(400, 'Biometric verification is not enabled.');
  const a = Buffer.from(r.rows[0].biometric_token_hash, 'hex');
  const b = crypto.createHash('sha256').update(String(token)).digest();
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Biometric verification failed.');
  return true;
}
async function getRecipientByGpxWallet(address) {
  const a = String(address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) throw new HttpError(400, 'Enter a valid GPX wallet address.');
  const r = await pool.query('SELECT id,first_name,last_name,username,photo_url,gpx_wallet_address FROM users WHERE lower(gpx_wallet_address)=lower($1)', [a]);
  if (!r.rowCount) throw new HttpError(404, 'No GPX Network account was found for this wallet.');
  const u = r.rows[0];
  return { id:u.id, name:displayName(u), first_name:u.first_name, last_name:u.last_name, photo_url:u.photo_url, gpx_wallet_address:u.gpx_wallet_address };
}

module.exports = {
  money, displayName, notifyUser, notifyAdmins, adStatus, startAd, rewardAd,
  registerUser, completeReferral, checkGate, clearGateCache, completeAutoTask, startTimerTask, completeTimerTask,
  createWithdrawal, processWithdrawal, approveWithdrawal, sendPayoutNow, recoverPayouts, classifyPayout, shortAddr,
  adjustBalance, setUserLevel, addAdmin, removeAdmin, setUserBanned, runBroadcast, ensureGpxWallet, generateGpxWallet, revokeGpxWallet, convertGpx, transferGpx, setNotifications, redeemPromo,
  hasPin, setTransactionPin, verifyTransactionPin, registerBiometric, verifyBiometric, getRecipientByGpxWallet
};
