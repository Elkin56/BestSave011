// lib/handlers/gate.js
// GET  /api/gate — состояние условий доступа
// POST /api/gate — перепроверить (кнопка «Я подписался»)
//
// Разницы в логике между методами нет: подписка каждый раз спрашивается у
// Telegram заново. POST существует ради явного намерения пользователя —
// и ради того, чтобы кнопка не кэшировалась на пути к серверу.

import { requireAuth } from '../auth.js';
import {
  ensureSchema, upsertUser, countReferrals, getGatePassedAt, markGatePassed,
} from '../db.js';
import { gateState, isSubscribedStatus, COMMUNITY_CHAT, REQUIRED_INVITES } from '../gate.js';

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

/**
 * Подписан ли пользователь на канал сообщества.
 * @returns {Promise<boolean|null>} null — проверить не удалось
 *
 * null отдельно от false намеренно: «бот не админ канала» и «человек не
 * подписан» — разные ситуации, и вторую нельзя показывать вместо первой.
 */
export async function checkSubscription(tgId, {
  token = process.env.BOT_TOKEN,
  chat = COMMUNITY_CHAT,
  fetchImpl = fetch,
} = {}) {
  if (!token || !chat) return null;
  try {
    const r = await fetchImpl(API(token, 'getChatMember'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, user_id: tgId }),
    });
    const json = await r.json();

    // Telegram отвечает ошибкой и когда человека в канале нет,
    // и когда бот не имеет прав. Первое — честный «не подписан».
    if (!json.ok) {
      const d = String(json.description || '').toLowerCase();
      if (d.includes('user not found') || d.includes('participant_id_invalid')) return false;
      console.warn('gate: getChatMember —', json.description);
      return null;
    }
    return isSubscribedStatus(json.result?.status, json.result?.is_member);
  } catch (e) {
    console.warn('gate: getChatMember failed —', e?.message);
    return null;
  }
}

// Имя бота нужно для реферальной ссылки. Кэшируем на тёплый контейнер.
let botUsername = null;
async function getBotUsername() {
  if (botUsername) return botUsername;
  const token = process.env.BOT_TOKEN;
  if (!token) return 'bestsaves_bot';
  try {
    const r = await fetch(API(token, 'getMe'), { method: 'POST' });
    const json = await r.json();
    botUsername = json?.result?.username || 'bestsaves_bot';
  } catch { botUsername = 'bestsaves_bot'; }
  return botUsername;
}

/**
 * Состояние гейта для пользователя + фиксация прохождения.
 * Вынесено из handler, чтобы переиспользовать в middleware роутера.
 */
export async function loadGate(tgUser) {
  await ensureSchema();
  await upsertUser(tgUser);

  const passedAt = await getGatePassedAt(tgUser.id);

  // Пройденный гейт больше не тревожит Telegram лишним запросом.
  if (passedAt) {
    return gateState({
      subscribed: true, invites: REQUIRED_INVITES, need: REQUIRED_INVITES,
      passedAt, botUsername: await getBotUsername(), tgId: tgUser.id,
    });
  }

  const [subscribed, invites, uname] = await Promise.all([
    checkSubscription(tgUser.id),
    countReferrals(tgUser.id),
    getBotUsername(),
  ]);

  const state = gateState({
    subscribed, invites, need: REQUIRED_INVITES,
    passedAt: null, botUsername: uname, tgId: tgUser.id,
  });

  if (state.passed) await markGatePassed(tgUser.id);
  return state;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    res.status(200).json(await loadGate(req.tgUser));
  } catch (e) {
    console.error('gate:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
