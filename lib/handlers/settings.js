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

      // Пользователь мог ещё ни разу не писать боту — создаём запись
      await upsertUser(req.tgUser);
      await setUserSettings(tgId, {
        notifyDeleted: body.notifyDeleted !== false,
        notifyEdited: body.notifyEdited === true,
      });
      return res.status(200).json(await getUserSettings(tgId));
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('/settings:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
