// api/export.js
// Скачивание чата одним файлом: автономный HTML со всеми сообщениями архива.
//
// Фото и голосовые ВСТРАИВАЮТСЯ в файл как base64 — открывается офлайн,
// без сервера и без ссылок с токеном. Чтобы не упереться в лимиты
// serverless-функции, действует бюджет на медиа (MEDIA_BUDGET байт):
// файлы встраиваются от новых к старым, пока бюджет не исчерпан;
// дальше вместо файла — честная пометка.
//
// Авторизация: initData в ?auth= (обычный download-запрос без заголовков).

import { requireAuth } from '../lib/auth.js';
import { q, ensureSchema } from '../lib/db.js';

const MAX_MESSAGES = 3000;                 // защита от гигантских архивов
const MEDIA_BUDGET = 9 * 1024 * 1024;      // ~9 МБ встроенных медиа на файл
const MEDIA_ITEM_MAX = 3 * 1024 * 1024;    // один файл не больше 3 МБ

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

async function tgFile(token, fileId) {
  const gf = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  }).then((r) => r.json()).catch(() => null);
  if (!gf?.ok || !gf.result?.file_path) return null;

  const r = await fetch(`https://api.telegram.org/file/bot${token}/${gf.result.file_path}`).catch(() => null);
  if (!r?.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = gf.result.file_path.split('.').pop()?.toLowerCase() || '';
  const mime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
    oga:'audio/ogg', ogg:'audio/ogg', mp3:'audio/mpeg', mp4:'video/mp4', gif:'image/gif' }[ext]
    || 'application/octet-stream';
  return { buf, mime };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAuth(req, res)) return;

  const chatId = req.query.chatId;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  const token = process.env.BOT_TOKEN;

  try {
    await ensureSchema();

    // Доступ + внутренний id чата
    const access = await q(
      `SELECT c.id, c.title
       FROM app_user u
       JOIN chat_link cl ON cl.user_id = u.id
       JOIN chat c ON c.id = cl.chat_id
       WHERE u.tg_id = $1 AND c.tg_chat_id = $2`,
      [req.tgUser.id, chatId]
    );
    if (access.rows.length === 0) return res.status(403).json({ error: 'not your chat' });
    const { id: internalId, title } = access.rows[0];

    const { rows: msgs } = await q(
      `SELECT id, sender_name, text, media_type, media_file_id,
              is_edited, is_deleted, sent_at
       FROM message WHERE chat_id = $1
       ORDER BY id DESC LIMIT $2`,
      [internalId, MAX_MESSAGES]
    );
    msgs.reverse(); // в файле — в хронологическом порядке

    // Встраиваем медиа от новых к старым в пределах бюджета
    let budget = MEDIA_BUDGET;
    const embedded = new Map(); // message.id -> data URI
    if (token) {
      const withMedia = msgs.filter((m) => m.media_file_id &&
        ['photo', 'voice', 'video_note', 'sticker'].includes(m.media_type));
      for (let i = withMedia.length - 1; i >= 0 && budget > 0; i--) {
        const m = withMedia[i];
        const f = await tgFile(token, m.media_file_id);
        if (!f || f.buf.length > MEDIA_ITEM_MAX || f.buf.length > budget) continue;
        budget -= f.buf.length;
        embedded.set(m.id, `data:${f.mime};base64,${f.buf.toString('base64')}`);
      }
    }

    const mediaHuman = { photo:'Фото', video:'Видео', voice:'Голосовое сообщение',
      video_note:'Видеокружок', document:'Файл', animation:'GIF', sticker:'Стикер' };

    const body = msgs.map((m) => {
      const dt = new Date(m.sent_at).toLocaleString('ru-RU', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const data = embedded.get(m.id);
      let media = '';
      if (m.media_type) {
        if (data && (m.media_type === 'photo' || m.media_type === 'sticker')) {
          media = `<img class="ph" src="${data}" alt="">`;
        } else if (data && m.media_type === 'voice') {
          media = `<audio controls preload="none" src="${data}"></audio>`;
        } else if (data && m.media_type === 'video_note') {
          media = `<video controls preload="none" class="vn" src="${data}"></video>`;
        } else {
          media = `<div class="att">📎 ${mediaHuman[m.media_type] || 'Вложение'}${m.media_file_id ? ' (не вошло в файл — лимит размера)' : ' (файл не сохранён архивом)'}</div>`;
        }
      }
      return `<div class="m${m.is_deleted ? ' del' : ''}">
        <div class="h"><b>${esc(m.sender_name || 'Кто-то')}</b><span class="t">${esc(dt)}</span>
          ${m.is_deleted ? '<span class="tag td">удалено</span>' : ''}
          ${m.is_edited && !m.is_deleted ? '<span class="tag te">изменено</span>' : ''}</div>
        ${m.text ? `<div class="x">${esc(m.text)}</div>` : ''}
        ${media}
      </div>`;
    }).join('\n');

    const now = new Date().toLocaleString('ru-RU');
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BestSave — ${esc(title || 'Чат')}</title>
<style>
  body{margin:0;padding:24px 16px;background:#0b0f0b;color:#e9f5e9;
    font:15px/1.5 system-ui,-apple-system,sans-serif}
  .wrap{max-width:640px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#7a8c7a;font-size:12.5px;margin-bottom:20px;font-variant-numeric:tabular-nums}
  .m{background:#131b13;border:1px solid #1d2a1d;border-radius:12px;padding:12px 14px;margin-bottom:8px}
  .m.del{border-color:rgba(255,77,77,.4);background:#1a1212}
  .h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}
  .t{color:#7a8c7a;font-size:11.5px;font-variant-numeric:tabular-nums}
  .tag{font-size:10px;font-weight:700;border-radius:5px;padding:1px 6px;margin-left:auto}
  .td{color:#ff4d4d;background:rgba(255,77,77,.12)}
  .te{color:#a855f7;background:rgba(168,85,247,.12)}
  .x{white-space:pre-wrap;word-break:break-word}
  .ph{max-width:100%;border-radius:10px;margin-top:8px;display:block}
  .vn{max-width:240px;border-radius:50%;margin-top:8px;display:block}
  audio{width:100%;margin-top:8px}
  .att{color:#7a8c7a;font-size:12.5px;margin-top:6px}
</style></head><body><div class="wrap">
<h1>${esc(title || 'Чат')}</h1>
<div class="sub">Экспорт BestSave · ${esc(now)} · сообщений: ${msgs.length}${msgs.length === MAX_MESSAGES ? ' (показаны последние)' : ''}</div>
${body || '<div class="att">Архив пуст.</div>'}
</div></body></html>`;

    const safeName = String(title || 'chat').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 40) || 'chat';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-disposition',
      `attachment; filename="bestsave.html"; filename*=UTF-8''${encodeURIComponent('BestSave — ' + safeName + '.html')}`);
    res.status(200).send(html);
  } catch (e) {
    console.error('GET /export:', e?.message);
    res.status(500).json({ error: 'internal' });
  }
}
