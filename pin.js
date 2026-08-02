// api/health.js
// Проверка живости + разовая инициализация схемы.
// Полезно дёрнуть один раз после деплоя, чтобы создать таблицы.

import { ensureSchema, q } from '../db.js';

export default async function handler(req, res) {
  const out = { ok: true, checks: {} };

  out.checks.botToken = Boolean(process.env.BOT_TOKEN);
  out.checks.database = Boolean(process.env.DATABASE_URL);

  // Число пользователей — внутренняя метрика, наружу её не отдаём.
  // Показываем только по секрету, как и диагностику.
  const detailed = Boolean(process.env.WEBHOOK_SECRET) &&
    req.query?.secret === process.env.WEBHOOK_SECRET;

  if (out.checks.database) {
    try {
      await ensureSchema();
      const { rows } = await q('SELECT count(*)::int AS n FROM app_user');
      out.checks.schema = true;
      if (detailed) out.checks.users = rows[0].n;
    } catch (e) {
      out.ok = false;
      out.checks.schema = false;
      if (detailed) out.checks.dbError = e?.message;
    }
  } else {
    out.ok = false;
  }

  res.status(out.ok ? 200 : 500).json(out);
}
