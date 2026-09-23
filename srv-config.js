const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
// ADMIN_IDS = comma separated Telegram user IDs, set in the Render environment (e.g. 7995243814,123456789).
// Spaces, quotes, brackets and semicolons are tolerated. If the variable is missing, the owner ID below is used.
const ADMIN_IDS = String(process.env.ADMIN_IDS || '7995243814')
  .split(/[\s,;]+/)
  .map((s) => Number(s.replace(/[^0-9]/g, '')))
  .filter((n) => Number.isFinite(n) && n > 0);

// Derived automatically so you never have to set one.
const WEBHOOK_SECRET = BOT_TOKEN
  ? crypto.createHash('sha256').update('webhook:' + BOT_TOKEN).digest('hex').slice(0, 48)
  : '';

module.exports = {
  BOT_TOKEN,
  PUBLIC_URL,
  ADMIN_IDS,
  WEBHOOK_SECRET,
  PORT: Number(process.env.PORT) || 3000,
  state: { bot: { id: null, username: null } } // filled from getMe() at startup
};
