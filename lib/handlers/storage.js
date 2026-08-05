// lib/handlers/storage.js
// GET  /api/storage — что можно вычистить (ничего не меняет).
// POST /api/storage — выполнить уборку по выбранным категориям.
//
// Принцип «сначала показать, потом удалять»: панель сперва отдаёт, сколько
// строк подпадает под каждую категорию, и только явный POST со списком
// категорий и словом подтверждения что-то удаляет.
//
// Чистится ТОЛЬКО мусор — данные, которые уже никому не принадлежат:
// чаты без владельцев, сообщения удалённых учётных записей, протухшие
// уведомления, мёртвые бизнес-подключения.
//
// Чего здесь намеренно нет: автоудаления «старых» сообщений по сроку.
// Политика конфиденциальности обещает, что архив живёт, пока владелец сам
// его не удалит. Ввести срок хранения можно — но это правка политики
// и уведомление пользователей, а не пункт в меню обслуживания.

import { requireAdmin } from '../auth.js';
import {
  ensureSchema, storageAudit, storageSweep, logAdminAction,
  recentAdminActions, SWEEP_KEYS,
} from '../db.js';

const CONFIRM_WORD = 'ОЧИСТИТЬ';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const [audit, log] = await Promise.all([storageAudit(), recentAdminActions(20)]);
      return res.status(200).json({ ...audit, log });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    if (body.confirm !== CONFIRM_WORD) {
      return res.status(400).json({ error: 'confirmation required', expect: CONFIRM_WORD });
    }

    const keys = (Array.isArray(body.keys) ? body.keys : []).filter((k) => SWEEP_KEYS.includes(k));
    if (!keys.length) return res.status(400).json({ error: 'nothing selected' });

    const done = await storageSweep(keys);
    const total = done.reduce((n, d) => n + d.deleted, 0);

    await logAdminAction(req.tgUser.id, 'sweep', null,
      done.map((d) => `${d.key}:${d.deleted}`).join(', '));
    console.log(`storage: ${req.tgUser.id} убрал ${total} строк`, done);

    // Свежий замер после уборки: интерфейс показывает, сколько освободилось.
    const after = await storageAudit();
    res.status(200).json({ ok: true, done, total, dbBytes: after.dbBytes });
  } catch (e) {
    console.error('/storage:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
