// lib/auth.js
// Проверка Telegram Mini App initData: HMAC-SHA256 по схеме WebAppData.
// Это то же ядро, что в основном проекте (auth/telegram-init-data.ts),
// перенесённое под serverless и покрытое отдельными тестами.

import crypto from 'node:crypto';

const MAX_AGE_SEC = 24 * 60 * 60; // сутки: перехваченный initData не должен жить вечно
const CLOCK_SKEW_SEC = 60;        // допуск на рассинхрон часов клиента

/**
 * Проверяет подпись и возраст initData.
 * @returns {{ ok: true, user: object } | { ok: false, reason: string }}
 */
export function verifyInitData(initData, botToken, now = Math.floor(Date.now() / 1000)) {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, reason: 'empty initData' };
  }
  if (!botToken) {
    return { ok: false, reason: 'server misconfigured: no bot token' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no hash' };

  params.delete('hash');

  // data_check_string: пары key=value, отсортированные по ключу, через \n
  const pairs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dcs = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secretKey).update(dcs).digest('hex');

  // timing-safe сравнение: строки одной длины, иначе timingSafeEqual бросит
  const a = Buffer.from(calc, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad signature' };
  }

  // Возраст: auth_date не старше суток и не из будущего
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: 'no auth_date' };
  }
  const age = now - authDate;
  if (age < -CLOCK_SKEW_SEC) return { ok: false, reason: 'auth_date in future' };
  if (age > MAX_AGE_SEC) return { ok: false, reason: 'initData expired' };

  // Парсим пользователя
  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, reason: 'bad user json' };
  }
  if (!user || typeof user.id !== 'number') {
    return { ok: false, reason: 'no user id' };
  }

  return { ok: true, user };
}

/**
 * Достаёт initData из заголовка Authorization: "tma <initData>".
 */
export function initDataFromHeader(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^tma\s+(.+)$/i.exec(auth);
  return m ? m[1] : null;
}

/**
 * Обёртка для API-роутов: проверяет initData, кладёт user в req.tgUser.
 * Возвращает true, если запрос авторизован; иначе сам отвечает 401 и возвращает false.
 */
export function requireAuth(req, res) {
  const token = process.env.BOT_TOKEN;
  const initData = initDataFromHeader(req);
  const result = verifyInitData(initData, token);
  if (!result.ok) {
    res.status(401).json({ error: 'unauthorized', reason: result.reason });
    return false;
  }
  req.tgUser = result.user;
  return true;
}
