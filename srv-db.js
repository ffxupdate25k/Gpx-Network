const { Pool, types } = require('pg');

types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> number
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT/COUNT -> number

const url = process.env.DATABASE_URL || '';
const isLocal = /localhost|127\.0\.0\.1/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10
});
pool.on('error', (e) => console.error('Postgres pool error:', e.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT PRIMARY KEY,
  first_name    TEXT,
  last_name     TEXT,
  username      TEXT,
  language_code TEXT,
  photo_url     TEXT,
  balance       NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  usdt_balance  NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (usdt_balance >= 0),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  gpx_wallet_address TEXT,
  gpx_wallet_revoked_at TIMESTAMPTZ,
  transaction_pin_hash TEXT,
  transaction_pin_salt TEXT,
  biometric_token_hash TEXT,
  ads_watch_date DATE,
  ads_watched_today INT NOT NULL DEFAULT 0,
  referred_by   BIGINT,
  bot_blocked   BOOLEAN NOT NULL DEFAULT FALSE,
  banned        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A referral is saved as 'pending' when the new user sends /start, and becomes
-- 'completed' (reward paid) once they open the Mini App and join the required channels.
CREATE TABLE IF NOT EXISTS referrals (
  referred_id  BIGINT PRIMARY KEY REFERENCES users(id),
  referrer_id  BIGINT NOT NULL REFERENCES users(id),
  reward       NUMERIC(14,4) NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_id);

CREATE TABLE IF NOT EXISTS referral_milestone_claims (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_referrals INT NOT NULL,
  reward NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, milestone_referrals)
);

CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  reward NUMERIC(14,4) NOT NULL DEFAULT 0,
  max_uses INT NOT NULL DEFAULT 0,
  uses INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promo_redemptions (
  code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(code,user_id)
);

-- Channels/groups every user must join before using the app (managed in the Admin panel).
CREATE TABLE IF NOT EXISTS channels (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reward      NUMERIC(14,4) NOT NULL CHECK (reward >= 0),
  url         TEXT NOT NULL DEFAULT '',
  verify_type TEXT NOT NULL CHECK (verify_type IN ('auto','timer')),
  timer_seconds INT NOT NULL DEFAULT 10 CHECK (timer_seconds BETWEEN 3 AND 86400),
  chat_id     TEXT NOT NULL DEFAULT '',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  max_completions INT NOT NULL DEFAULT 0 CHECK (max_completions >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id          SERIAL PRIMARY KEY,
  task_id     INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  image       BYTEA,
  mime        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_active_uniq
  ON task_submissions(task_id, user_id) WHERE status IN ('pending','approved');

CREATE TABLE IF NOT EXISTS transactions (
  id         SERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  amount     NUMERIC(14,4) NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions(user_id, id DESC);

CREATE TABLE IF NOT EXISTS ad_claims (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ad_claims_user_idx ON ad_claims(user_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS ad_claims_nonce_hash_uniq ON ad_claims(nonce_hash);


CREATE TABLE IF NOT EXISTS withdrawals (
  id             SERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id),
  amount         NUMERIC(14,4) NOT NULL CHECK (amount > 0),
  address        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  transaction_id INT REFERENCES transactions(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,
  processed_by   BIGINT,
  fee            NUMERIC(18,6) NOT NULL DEFAULT 0,
  payout_amount  NUMERIC(18,6)
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id         SERIAL PRIMARY KEY,
  text       TEXT NOT NULL,
  photo_url  TEXT NOT NULL DEFAULT '',
  buttons    JSONB NOT NULL DEFAULT '[]'::jsonb,
  total      INT NOT NULL DEFAULT 0,
  sent       INT NOT NULL DEFAULT 0,
  failed     INT NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'running',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Upgrades for databases created by an earlier version. Old referrals were paid instantly, so they stay 'completed'.
const MIGRATIONS = `
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Manually entered USDT BEP20 wallet (one wallet can belong to only one account).
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_connected_at TIMESTAMPTZ;
-- wallet_qr_image / wallet_qr_mime: from an earlier version that asked for a QR screenshot.
-- No longer written to; left in place only so nothing breaks for anyone who already has them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_qr_image BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_qr_mime TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS usdt_balance NUMERIC(18,6) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level_override INT;
CREATE TABLE IF NOT EXISTS admin_users (
  user_id BIGINT PRIMARY KEY,
  added_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gpx_wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gpx_wallet_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS transaction_pin_salt TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_watch_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_watched_today INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_withdrawal_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_gpx_wallet_uniq ON users(lower(gpx_wallet_address)) WHERE gpx_wallet_address IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_uniq ON users (lower(wallet_address)) WHERE wallet_address IS NOT NULL;

-- Automatic payout tracking.
-- payout_state: manual = waiting for the admin, sending = the payout API call is in flight,
--               review = unclear result, the admin must check, done = finished
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_state TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_response TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee NUMERIC(18,6) NOT NULL DEFAULT 0;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_amount NUMERIC(18,6);
UPDATE withdrawals SET payout_amount = amount - fee WHERE payout_amount IS NULL;

-- Rich broadcasts: optional photo and inline buttons.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Timer-based tasks: instead of a screenshot, a per-task countdown (seconds) runs after the
-- user opens the task link, and the reward is credited once enough time has genuinely passed.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timer_seconds INT NOT NULL DEFAULT 10;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_completions INT NOT NULL DEFAULT 0;
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n
  FROM tasks
)
UPDATE tasks t SET sort_order = o.n FROM ordered o WHERE o.id = t.id AND (t.sort_order IS NULL OR t.sort_order = 0);
ALTER TABLE tasks ALTER COLUMN sort_order SET DEFAULT 0;
UPDATE tasks SET sort_order = id WHERE sort_order IS NULL OR sort_order = 0;
UPDATE tasks SET max_completions = 0 WHERE max_completions IS NULL OR max_completions < 0;
CREATE INDEX IF NOT EXISTS tasks_sort_order_idx ON tasks(sort_order, id);
UPDATE tasks SET verify_type = 'timer' WHERE verify_type = 'screenshot';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_verify_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_verify_type_check CHECK (verify_type IN ('auto','timer'));
`;

// Starting values only. Everything here is editable in the Admin panel afterwards.
const DEFAULTS = {
  referral_reward: '100',
  gpx_per_001_usdt: '100',
  min_conversion_gpx: '1000',
  withdrawals_per_day: '2',
  referral_milestones: '[{"referrals":100,"reward":500},{"referrals":500,"reward":2500},{"referrals":1000,"reward":10000}]',
  referral_reward_message: '🎉 New referral!\n\nName: {{name}}\nUsername: {{username}}\nReward: +{{reward}} GPX\nYour completed referrals: {{referrals}}\nLevel: {{level}}\n\n{{milestone}}',
  notifications_default: 'true',
  min_withdraw: '0.10',
  max_withdraw: '0',
  withdrawal_fee: '0.10',
  ad_reward_gpx: '100',
  max_ads_per_day: '30',
  required_ads_before_withdrawal: '10',
  required_tasks_before_withdrawal: '2',
  withdrawal_cooldown_hours: '24',
  monetag_zone_id: '11878092',
  monetag_sdk_src: 'https://libtl.com/sdk.js',
  welcome_text: 'Welcome to GPX Network! Tap the button below to open the app and start earning GPX.',
  welcome_photo_url: '',
  welcome_emoji_ids: '',
  auto_payout: 'true',
  payout_api_url: 'https://pt-kappa-ten.vercel.app/pay/bep20',
  payout_api_key: '',
  payout_token_address: '',
  payout_channel_enabled: 'false',
  payout_channel: ''
};

async function init() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
}

async function getSettings(q = pool) {
  const { rows } = await q.query('SELECT key, value FROM settings');
  const raw = { ...DEFAULTS };
  rows.forEach((r) => { raw[r.key] = r.value; });
  let referral_milestones=[]; try { referral_milestones=JSON.parse(raw.referral_milestones||'[]'); } catch(_) {}
  return {
    referral_reward:Number(raw.referral_reward), gpx_per_001_usdt:Number(raw.gpx_per_001_usdt), min_conversion_gpx:Number(raw.min_conversion_gpx),
    withdrawals_per_day:Number(raw.withdrawals_per_day), referral_milestones, referral_reward_message:raw.referral_reward_message || DEFAULTS.referral_reward_message, notifications_default:raw.notifications_default==='true',
    min_withdraw:Number(raw.min_withdraw), max_withdraw:Number(raw.max_withdraw), withdrawal_fee:Number(raw.withdrawal_fee),
    ad_reward_gpx:Number(raw.ad_reward_gpx), max_ads_per_day:Number(raw.max_ads_per_day),
    required_ads_before_withdrawal:Number(raw.required_ads_before_withdrawal), required_tasks_before_withdrawal:Number(raw.required_tasks_before_withdrawal),
    withdrawal_cooldown_hours:Number(raw.withdrawal_cooldown_hours), monetag_zone_id:'11878092', monetag_sdk_src:'https://libtl.com/sdk.js', welcome_text:raw.welcome_text,
    welcome_photo_url:raw.welcome_photo_url, welcome_emoji_ids:raw.welcome_emoji_ids||'', auto_payout:raw.auto_payout==='true',
    payout_api_url:raw.payout_api_url, payout_api_key:raw.payout_api_key, payout_token_address:raw.payout_token_address,
    payout_channel_enabled:raw.payout_channel_enabled==='true', payout_channel:raw.payout_channel||''
  };
}

async function saveSettings(s) {
  for (const [key, value] of Object.entries(s)) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, String(value)]
    );
  }
}

// Runs fn inside a database transaction.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, getSettings, saveSettings, tx };
