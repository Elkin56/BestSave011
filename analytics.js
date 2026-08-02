// api/erase.js
// Удаление всех данных пользователя — право, обещанное в политике
// конфиденциальности, должно быть исполнимым в приложении.
//
// Действие необратимо, поэтому требуется явное подтверждение в теле
// запроса: { "confirm": "УДАЛИТЬ" }. Случайный POST ничего не сотрёт.

import { requireAuth } from '../auth.js';
import { ensureSchema, eraseUserData } from '../db.js';

const CONFIRM_WORD = 'УДАЛИТЬ';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (body.confirm !== CONFIRM_WORD) {
    return res.status(400).json({ error: 'confirmation required', expect: CONFIRM_WORD });
  }

  try {
    await ensureSchema();
    const result = await eraseUserData(req.tgUser.id);
    console.log(`erase: пользователь ${req.tgUser.id} удалил данные`, result);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('POST /erase:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
