// api/settings.js
// Настройки пользователя: уведомления от бота об удалении/изменении
// сообщений в подключённых личных чатах (Business-режим).
// GET — текущее состояние, POST — сохранить.

import { requireAuth } from '../auth.js';
import { ensureSchema, getUserSettings, setUserSettings, upsertUser } from '../db.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  try {
    await ensureSchema();
    const tgId = req.tgUser.id;

    if (req.method === 'GET') {
      return res.status(200).json(await getUserSettings(tgId));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};

      // Часы и смещение приходят от клиента — приводим к допустимым
      // диапазонам, чтобы в базу не попало произвольное число.
      const hour = (v, def) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n <= 23 ? n : def;
      };
      const tz = Number(body.tzOffsetMin);
      const tzSafe = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? Math.trunc(tz) : 0;

      // Пользователь мог ещё ни разу не писать боту — создаём запись
      await upsertUser(req.tgUser);
      await setUserSettings(tgId, {
        notifyDeleted: body.notifyDeleted !== false,
        notifyEdited: body.notifyEdited === true,
        notifyFake: body.notifyFake !== false,
        quietHours: body.quietHours === true,
        quietFrom: hour(body.quietFrom, 23),
        quietTo: hour(body.quietTo, 8),
        tzOffsetMin: tzSafe,
      });
      return res.status(200).json(await getUserSettings(tgId));
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('/settings:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
