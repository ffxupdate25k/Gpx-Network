const express = require('express');
const { pool, getSettings } = require('./srv-db');
const { requireAuth, requireGate } = require('./srv-auth');
const svc = require('./srv-services');
const tgApi = require('./srv-telegram');
const { state } = require('./srv-config');
const { HttpError, wrap } = require('./srv-errors');

const router = express.Router();
router.use(requireAuth);

// The Mini App calls this first. It always does a live check, and pays a pending referral
// as soon as the user is in every required channel.
router.get('/gate', wrap(async (req, res) => {
  if (req.isAdmin) return res.json({ passed: true, channels: [] });
  res.json(await svc.checkGate(req.user.id, { force: true }));
}));

// Everything below needs the user to be in all required channels.
router.use(requireGate);

router.get('/me', wrap(async (req,res)=>{
  const s=await getSettings();
  const ref=await pool.query(`SELECT COUNT(*) AS n,COALESCE(SUM(reward),0) AS earned FROM referrals WHERE referrer_id=$1 AND status='completed'`,[req.user.id]);
  const tasks=await pool.query(`SELECT COUNT(*) AS n FROM task_submissions WHERE user_id=$1 AND status='approved'`,[req.user.id]);
  const total=await pool.query(`SELECT COALESCE(SUM(amount),0) AS n FROM transactions WHERE user_id=$1 AND amount>0`,[req.user.id]);
  const referrals=Number(ref.rows[0].n); const level=Math.max(0, Number(req.user.level_override ?? Math.floor(referrals/100))); const next=(level+1)*100;
  const wallet=req.user.gpx_wallet_address || await svc.ensureGpxWallet(req.user.id);
  const ads=await svc.adStatus(req.user.id);
  res.json({id:req.user.id,name:svc.displayName(req.user),first_name:req.user.first_name,username:req.user.username,balance:Number(req.user.balance),usdt_balance:Number(req.user.usdt_balance||0),referrals,is_admin:req.isAdmin,created_at:req.user.created_at,referral_link:`https://t.me/${state.bot.username}?start=ref_${req.user.id}`,wallet_address:req.user.wallet_address||null,gpx_wallet_address:wallet,notifications_enabled:req.user.notifications_enabled!==false,level,level_progress:level>=10?100:(referrals%100),next_level_referrals:next,total_earned:Number(total.rows[0].n),tasks_completed:Number(tasks.rows[0].n),auto_payout:!!(s.auto_payout&&s.payout_api_key&&s.payout_token_address),referral_reward:s.referral_reward,min_withdraw:s.min_withdraw,max_withdraw:s.max_withdraw,withdrawal_fee:s.withdrawal_fee,withdrawals_per_day:s.withdrawals_per_day,ad_status:ads});
}));
router.get('/ads/status', wrap(async (req,res)=>res.json(await svc.adStatus(req.user.id))));
router.post('/ads/start', wrap(async (req,res)=>res.json(await svc.startAd(req.user.id))));
router.post('/ads/reward', wrap(async (req,res)=>res.json(await svc.rewardAd(req.user.id,(req.body||{}).nonce))));

router.get('/history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.title, t.amount, t.status, t.type, t.created_at AS date,
            w.id AS withdrawal_id, w.address AS withdrawal_address, w.tx_hash AS withdrawal_tx_hash,
            w.payout_state AS withdrawal_payout_state, w.note AS withdrawal_note
       FROM transactions t
       LEFT JOIN withdrawals w ON w.transaction_id = t.id
      WHERE t.user_id = $1
      ORDER BY t.id DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
}));

router.get('/referrals',wrap(async(req,res)=>{const s=await getSettings();const totals=await pool.query(`SELECT COUNT(*) FILTER(WHERE status='completed') AS count,COUNT(*) FILTER(WHERE status='pending') AS pending,COALESCE(SUM(reward) FILTER(WHERE status='completed'),0) AS earned FROM referrals WHERE referrer_id=$1`,[req.user.id]);const recent=await pool.query(`SELECT u.first_name,u.last_name,u.username,u.id,r.status,r.created_at AS date FROM referrals r JOIN users u ON u.id=r.referred_id WHERE r.referrer_id=$1 ORDER BY r.created_at DESC LIMIT 10`,[req.user.id]);res.json({count:Number(totals.rows[0].count),pending:Number(totals.rows[0].pending),earned:Number(totals.rows[0].earned),reward:s.referral_reward,milestones:s.referral_milestones.map(m=>({...m,level:Math.floor(Number(m.referrals)/100)})),recent:recent.rows.map(r=>({name:svc.displayName(r),status:r.status,date:r.date}))});}));

router.get('/leaderboard',wrap(async(req,res)=>{const {rows}=await pool.query(`SELECT u.username,u.first_name,u.last_name,u.balance,(SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=u.id AND r.status='completed') AS referrals FROM users u ORDER BY u.balance DESC LIMIT 20`);res.json(rows.map(r=>({...r,name:svc.displayName(r)})));}));
router.get('/promo-codes',wrap(async(req,res)=>{const {rows}=await pool.query(`SELECT code,reward,max_uses,uses FROM promo_codes WHERE active ORDER BY created_at DESC LIMIT 20`);res.json(rows);}));
router.post('/promo-codes/redeem',wrap(async(req,res)=>{res.json(await svc.redeemPromo(req.user.id,(req.body||{}).code));}));
router.post('/convert',wrap(async(req,res)=>{res.json(await svc.convertGpx(req.user.id,(req.body||{}).amount));}));
router.post('/gpx-wallet/generate',wrap(async(req,res)=>{res.json({address:await svc.generateGpxWallet(req.user.id)});}));
router.post('/gpx-wallet/revoke',wrap(async(req,res)=>{res.json({ok:await svc.revokeGpxWallet(req.user.id)});}));
router.get('/onchain/recipient',wrap(async(req,res)=>{res.json(await svc.getRecipientByGpxWallet(req.query.address));}));
router.post('/security/pin',wrap(async(req,res)=>{res.json({ok:await svc.setTransactionPin(req.user.id,(req.body||{}).pin,(req.body||{}).current_pin||'')});}));
router.get('/security',wrap(async(req,res)=>{res.json(await svc.hasPin(req.user.id));}));
router.post('/security/verify-pin',wrap(async(req,res)=>{res.json({ok:await svc.verifyTransactionPin(req.user.id,(req.body||{}).pin)});}));
router.post('/security/biometric/register',wrap(async(req,res)=>{res.json({ok:await svc.registerBiometric(req.user.id,(req.body||{}).token,(req.body||{}).pin)});}));
router.post('/security/biometric/verify',wrap(async(req,res)=>{res.json({ok:await svc.verifyBiometric(req.user.id,(req.body||{}).token)});}));
router.post('/onchain/transfer',wrap(async(req,res)=>{const b=req.body||{};const security=b.security||{};if(security.type==='biometric')await svc.verifyBiometric(req.user.id,security.token);else await svc.verifyTransactionPin(req.user.id,security.pin);res.json(await svc.transferGpx(req.user.id,b.address,b.amount));}));
router.post('/support',wrap(async(req,res)=>{
  const q=String((req.body||{}).message||'').trim().slice(0,500);
  if(!q) throw new HttpError(400,'Enter a message.');
  const low=q.toLowerCase();
  let answer='I can help with GPX Network. You can ask about withdrawals, GPX transfers, referrals, tasks, conversion, your wallet, or account support.';
  if(/withdraw|cash.?out|payout|fee/.test(low)) answer='Withdrawals are reviewed by an admin before payout. Open Wallet → Withdraw, connect your USDT BEP20 wallet, enter the amount and submit. Your request stays Processing until it is approved or rejected.';
  else if(/transfer|send gpx|onchain|pin|biometric/.test(low)) answer='For GPX transfers, open Onchain Transfer, enter the recipient GPX wallet and amount, verify the recipient profile, then confirm with your 4-digit Transaction PIN or enabled biometrics.';
  else if(/referr|invite/.test(low)) answer='Your referral reward is credited after the referred user completes the required referral conditions. A pending referral does not trigger the referrer notification yet.';
  else if(/convert|rate|usdt/.test(low)) answer='GPX conversion uses the rate configured by the administrator. Open Convert to see the current conversion requirements available to your account.';
  else if(/task|reward/.test(low)) answer='Open Tasks to see available tasks and their GPX rewards. Follow each task instructions and complete its verification step.';
  else if(/wallet|address/.test(low)) answer='Your payout wallet is your saved USDT BEP20 address. For GPX receiving, use your GPX wallet address shown in the Wallet or Onchain Transfer section.';
  res.json({answer});
}));

router.post('/notifications',wrap(async(req,res)=>{res.json({enabled:await svc.setNotifications(req.user.id,(req.body||{}).enabled)});}));

// Tasks with this user's progress. chat_id is never sent to users. For a timer task the
// user is currently waiting on, remaining_seconds tells the client how much longer to count.
router.get('/tasks', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.description, t.reward, t.url, t.verify_type, t.timer_seconds,
            COALESCE(s.status, 'todo') AS raw_status,
            GREATEST(0, t.timer_seconds - EXTRACT(EPOCH FROM (now() - s.created_at)))::int AS remaining_seconds
       FROM tasks t
       LEFT JOIN LATERAL (
         SELECT status, created_at FROM task_submissions
          WHERE task_id = t.id AND user_id = $1
          ORDER BY (status = 'approved') DESC, (status = 'pending') DESC, id DESC LIMIT 1
       ) s ON true
      WHERE t.active ORDER BY t.id`,
    [req.user.id]
  );
  res.json(rows.map((r) => ({
    id: r.id, title: r.title, description: r.description, reward: r.reward, url: r.url,
    verify_type: r.verify_type, timer_seconds: r.timer_seconds,
    status: r.raw_status === 'approved' ? 'done' : r.raw_status === 'pending' ? 'pending' : 'todo',
    remaining_seconds: r.raw_status === 'pending' ? r.remaining_seconds : null
  })));
}));

async function getTask(idParam, verifyType) {
  const id = parseInt(idParam, 10);
  if (!id) throw new HttpError(404, 'Task not found.');
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 AND active', [id]);
  if (!rows.length) throw new HttpError(404, 'Task not found.');
  if (rows[0].verify_type !== verifyType) throw new HttpError(400, 'This task is checked a different way. Reload the page.');
  return rows[0];
}

// Timer task, step 1: the user tapped "Start" and (usually) opened the task's link. This
// starts the server-side clock; it's idempotent, so reopening the task never restarts it.
router.post('/tasks/:id/start', wrap(async (req, res) => {
  const task = await getTask(req.params.id, 'timer');
  const startedAt = await svc.startTimerTask(task, req.user.id);
  const remaining = Math.max(0, task.timer_seconds - Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  res.json({ remaining_seconds: remaining });
}));

// Auto-verify: the bot checks that the user is a member of the task's channel/group.
router.post('/tasks/:id/claim', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) throw new HttpError(404, 'Task not found.');
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 AND active', [id]);
  if (!rows.length) throw new HttpError(404, 'Task not found.');
  const task = rows[0];

  let balance;
  if (task.verify_type === 'auto') {
    let member;
    try {
      member = await tgApi.getChatMember(task.chat_id, req.user.id);
    } catch (e) {
      console.error(`Verification failed for task ${task.id}:`, e.message);
      throw new HttpError(503, "We couldn't check this task right now. Please try again later.");
    }
    const joined =
      ['creator', 'administrator', 'member'].includes(member.status) ||
      (member.status === 'restricted' && member.is_member);
    if (!joined) throw new HttpError(400, "We couldn't find you there yet. Join first, then tap Verify again.");
    balance = await svc.completeAutoTask(task, req.user.id);
  } else {
    balance = await svc.completeTimerTask(task, req.user.id);
  }
  res.json({ reward: task.reward, balance });
}));

// Saves the USDT BEP20 wallet address the user typed. Can only be set once; an admin can
// reset it in Users if the user made a mistake.
router.post('/wallet', wrap(async (req, res) => {
  const address = String((req.body || {}).address || '').trim().toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/.test(address)) {
    throw new HttpError(400, 'That is not a valid USDT BEP20 wallet address.');
  }
  let r;
  try {
    r = await pool.query(
      `UPDATE users SET wallet_address = $1, wallet_connected_at = now()
        WHERE id = $2 AND wallet_address IS NULL RETURNING wallet_address`,
      [address, req.user.id]
    );
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'This wallet address is already linked to another account.');
    throw e;
  }
  if (!r.rowCount) throw new HttpError(409, 'Your wallet is already saved.');
  res.json({ wallet_address: r.rows[0].wallet_address });
}));

router.get('/withdrawals/:id/status', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) throw new HttpError(404, 'Withdrawal not found.');
  const { rows } = await pool.query(
    `SELECT id, amount, fee, payout_amount, address, status, payout_state, tx_hash, note, created_at
       FROM withdrawals WHERE id = $1 AND user_id = $2`,
    [id, req.user.id]
  );
  if (!rows.length) throw new HttpError(404, 'Withdrawal not found.');
  const w = rows[0];
  res.json({
    id: w.id,
    amount: Number(w.amount),
    address: w.address,
    status: w.status,
    payout_state: w.payout_state,
    tx_hash: w.tx_hash || null,
    note: w.note || null,
    fee: Number(w.fee || 0),
    payout_amount: Number(w.payout_amount ?? w.amount),
    created_at: w.created_at
  });
}));

router.post('/withdrawals', wrap(async (req, res) => {
  const result = await svc.createWithdrawal(req.user, (req.body || {}).amount);
  res.json({ ok: true, id: result.id, balance: result.balance, auto: result.auto });
}));

module.exports = router;
