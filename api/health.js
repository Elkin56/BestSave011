// api/health.js
// Проверка живости + разовая инициализация схемы.
// Полезно дёрнуть один раз после деплоя, чтобы создать таблицы.

import { ensureSchema, q } from '../lib/db.js';

export default async function handler(req, res) {
  const out = { ok: true, checks: {} };

  out.checks.botToken = Boolean(process.env.BOT_TOKEN);
  out.checks.database = Boolean(process.env.DATABASE_URL);

  if (out.checks.database) {
    try {
      await ensureSchema();
      const { rows } = await q('SELECT count(*)::int AS n FROM app_user');
      out.checks.schema = true;
      out.checks.users = rows[0].n;
    } catch (e) {
      out.ok = false;
      out.checks.schema = false;
      out.checks.dbError = e?.message;
    }
  } else {
    out.ok = false;
  }

  res.status(out.ok ? 200 : 500).json(out);
}
