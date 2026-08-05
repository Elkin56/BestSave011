// api/erase.js
// Удаление всех данных пользователя — право, обещанное в политике
// конфиденциальности, должно быть исполнимым в приложении.
//
// Действие необратимо, поэтому требуется явное подтверждение в теле
// запроса: { "confirm": "УДАЛИТЬ" }. Случайный POST ничего не сотрёт.
//
// Два масштаба:
//   { confirm } — весь архив и учётная запись;
//   { confirm, chatId } — только один чат. Тот же пароль подтверждения:
//     удаление переписки целого чата не «мельче» по последствиям.
//     Дополнительно { unlink: true } отвязывает чат, чтобы он не наполнялся
//     заново — без этого очистка выглядела бы бесполезной для тех, кто
//     хочет именно перестать сохранять чат.

import { requireAuth } from '../auth.js';
import { ensureSchema, eraseUserData, eraseChatForUser } from '../db.js';

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

    if (body.chatId) {
      const r = await eraseChatForUser(req.tgUser.id, String(body.chatId),
        { unlink: body.unlink === true });
      // null — чата нет или он не этого человека. Ответ одинаковый в обоих
      // случаях: иначе перебором можно было бы узнать, какие чаты существуют.
      if (!r) return res.status(404).json({ error: 'chat not found' });
      console.log(`erase: пользователь ${req.tgUser.id} очистил чат`, r);
      return res.status(200).json({ ok: true, scope: 'chat', ...r });
    }

    const result = await eraseUserData(req.tgUser.id);
    console.log(`erase: пользователь ${req.tgUser.id} удалил данные`, result);
    res.status(200).json({ ok: true, scope: 'account', ...result });
  } catch (e) {
    console.error('POST /erase:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
