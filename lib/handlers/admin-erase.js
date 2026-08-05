// lib/handlers/admin-erase.js
// POST /api/admin-erase — очистка данных пользователя владельцем продукта.
//
// Зачем нужно: обращения собеседников об удалении их сообщений, требования
// уполномоченных органов, злоупотребления, разбор инцидентов.
//
// Три правила, заданные намеренно:
//
// 1. НЕ ДАЁТ ЧИТАТЬ. Возвращаются только счётчики. Панель владельца никогда
//    не показывает названия чатов и тексты — в политике написано, что архив
//    виден только владельцу архива, и удаление не повод это нарушить.
//
// 2. НЕ БЕССЛЕДНО. Каждое действие пишется в admin_action. Возможность
//    незаметно стереть чужие данные — это ровно то, чего в продукте
//    про приватность быть не должно.
//
// 3. ЧЕЛОВЕК УЗНАЁТ. Бот сообщает пользователю, что его архив очищен.
//    Молчаливое удаление означало бы, что человек продолжает считать
//    переписку сохранённой, — и обнаружит потерю в худший момент.

import { requireAdmin } from '../auth.js';
import { ensureSchema, adminEraseUser, logAdminAction } from '../db.js';

const CONFIRM_WORD = 'УДАЛИТЬ';
const MODES = ['archive', 'full'];

async function tellUser(tgId, mode) {
  const token = process.env.BOT_TOKEN;
  if (!token || !tgId) return;
  const text = mode === 'full'
    ? '🗑 Ваша учётная запись и весь архив BestSave удалены администратором ' +
      'сервиса. Восстановить данные невозможно.\n\n' +
      'Чтобы начать заново, отправьте /start.'
    : '🗑 Архив BestSave очищен администратором сервиса: сохранённые ' +
      'сообщения удалены.\n\n' +
      'Бот продолжает работать — новые сообщения будут сохраняться как обычно.';
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(tgId), text }),
    });
  } catch (e) {
    // Уведомить не удалось (бот заблокирован) — это не повод отменять
    // удаление, но в журнале след должен остаться.
    console.warn('admin-erase: уведомить не удалось —', e?.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAdmin(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const target = String(body.tgId || '').trim();
  const mode = MODES.includes(body.mode) ? body.mode : 'archive';

  if (!/^\d+$/.test(target)) return res.status(400).json({ error: 'tgId required' });
  if (body.confirm !== CONFIRM_WORD) {
    return res.status(400).json({ error: 'confirmation required', expect: CONFIRM_WORD });
  }
  // Себя админ удаляет через обычный экран «Конфиденциальность»: там то же
  // подтверждение, и незачем иметь два пути к одному разрушительному действию.
  if (target === String(req.tgUser.id)) {
    return res.status(400).json({ error: 'use your own privacy screen' });
  }

  try {
    await ensureSchema();
    const r = await adminEraseUser(target, mode);
    if (!r) return res.status(404).json({ error: 'user not found' });

    await logAdminAction(req.tgUser.id, `erase:${mode}`, target,
      `сообщений: ${r.messages}`);
    console.log(`admin-erase: ${req.tgUser.id} очистил ${target} (${mode})`, r);

    // Уведомляем после удаления: сначала выполняем обещанное действие,
    // потом сообщаем. Обратный порядок мог бы соврать при сбое.
    if (body.notify !== false) await tellUser(target, mode);

    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('POST /admin-erase:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
