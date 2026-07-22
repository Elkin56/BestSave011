// public/app.js — фронтенд Mini App BestSave (триал).
// Работает поверх Telegram WebApp SDK. Все запросы к /api/* несут initData
// в заголовке Authorization: сервер проверяет подпись.

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';

// ─── API-клиент ───
async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'authorization': 'tma ' + initData,
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.reason || body.error || `HTTP ${r.status}`);
  }
  return r.json();
}

const S = { tab: 'chats', chats: [], chat: null, messages: [], chatFilter: 'all', loading: false, error: null, botUsername: null, businessConnected: false, businessSince: null };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmt = (n) => Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');

// Username бота НЕ хардкодим и НЕ берём из initData (там username пользователя,
// а нам нужен бот). Спрашиваем у сервера — он знает через getMe.
// Пока не загрузился, кнопка «Добавить бота» заблокирована, чтобы не открыть
// битую ссылку t.me/<заглушка>.

// ─── username бота (для ссылки «добавить в чат») ───
async function loadBotUsername() {
  try {
    const info = await api('/api/bot-info');
    if (info?.username) S.botUsername = info.username;
  } catch {
    // Не критично для просмотра архива — просто кнопка добавления будет ждать.
  }
}

// Ссылка на добавление бота в группу. Возвращает null, пока имя не известно.
function addBotLink() {
  return S.botUsername
    ? `https://t.me/${encodeURIComponent(S.botUsername)}?startgroup=archive`
    : null;
}

// ─── загрузка данных ───
async function loadChats() {
  S.loading = true; S.error = null; render();
  try {
    const data = await api('/api/chats');
    S.chats = data.chats || [];
    S.businessConnected = Boolean(data.businessConnected);
    S.businessSince = data.businessSince || null;
  } catch (e) {
    S.error = e.message;
  } finally {
    S.loading = false; render();
  }
}

async function openChat(chatId) {
  S.chat = S.chats.find((c) => c.chatId === chatId);
  S.tab = 'chat'; S.chatFilter = 'all'; S.messages = []; S.loading = true; render();
  try {
    const { messages } = await api(`/api/messages?chatId=${encodeURIComponent(chatId)}&filter=all`);
    S.messages = messages;
  } catch (e) {
    S.error = e.message;
  } finally {
    S.loading = false; render();
  }
}

async function setFilter(f) {
  S.chatFilter = f; S.loading = true; render();
  try {
    const { messages } = await api(`/api/messages?chatId=${encodeURIComponent(S.chat.chatId)}&filter=${f}`);
    S.messages = messages;
  } catch (e) {
    S.error = e.message;
  } finally {
    S.loading = false; render();
  }
}

// ─── экраны ───
function ChatsScreen() {
  if (S.loading && S.chats.length === 0) return spinner();
  if (S.error) return errorBox(S.error);

  const empty = S.chats.length === 0;
  return `
    <div class="hero">
      <div class="hero-glow"></div>
      <img class="cat" src="/cat.jpg" width="520" height="620" decoding="async" alt="BestSave">
      <div class="hero-title">Пробная версия</div>
      <div class="hero-sub">Архивируем чаты, где бот — администратор</div>
    </div>

    ${empty && S.businessConnected ? `
      <div class="card connect">
        <div class="ok-badge">✅ Бизнес-подключение активно</div>
        <div class="note" style="margin:14px 0 0;font-size:13px;line-height:1.6">
          Я подключён к вашим личным чатам и слежу за ними прямо сейчас.
          <br><br>
          <b style="color:var(--gold)">Почему список пуст?</b> Архив начинается с момента подключения —
          Telegram не даёт ботам выгружать прошлую переписку. Как только в любом
          из чатов придёт <b style="color:var(--txt)">новое сообщение</b>, чат появится здесь
          вместе с ним.
          <br><br>
          Попробуйте: попросите кого-нибудь написать вам или напишите сами в любой чат,
          затем обновите этот экран.
        </div>
        <button class="btn-green" data-retry style="margin-top:16px">Обновить</button>
        <div class="note" style="margin-top:14px">
          Можно подключить и группы: добавьте бота в чат и назначьте администратором.
        </div>
        ${addBotLink() ? `<a class="btn-ghost" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot style="margin:8px 0 0">Добавить бота в группу</a>` : ''}
      </div>
    ` : empty ? `
      <div class="card connect">
        <div class="connect-title">💬 Личные чаты</div>
        <div class="connect-step"><span class="num">1</span> Настройки Telegram → Telegram Business → Чат-боты</div>
        <div class="connect-step"><span class="num">2</span> Впишите ${S.botUsername ? '@' + esc(S.botUsername) : 'этого бота'}</div>
        <div class="connect-step"><span class="num">3</span> Разрешите доступ к нужным чатам</div>
        <div class="note" style="margin:6px 0 18px">Нужен Telegram Premium. Здесь ловится удаление в момент удаления.</div>

        <div class="connect-title">📁 Группы и каналы</div>
        <div class="connect-step"><span class="num">1</span> Добавьте бота в вашу группу или канал</div>
        <div class="connect-step"><span class="num">2</span> Назначьте администратором</div>
        <div class="connect-step"><span class="num">3</span> Бот начнёт сохранять переписку</div>
        ${addBotLink()
          ? `<a class="btn-green" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot>Добавить бота в чат</a>`
          : `<button class="btn-green" disabled style="opacity:.5">Загружаем данные бота…</button>`}
        <div class="note">
          <b style="color:var(--gold)">Почему список пуст?</b> Архив начинается с момента подключения.
          Telegram не даёт ботам выгружать прошлую переписку — старые сообщения
          подтянуть невозможно. Чат появится здесь, как только в нём придёт
          первое новое сообщение.
          <br><br>
          Чужие переписки, где вас нет, бот не видит — и мы это не обходим.
        </div>
      </div>
    ` : `
      <div class="sec">Подключённые чаты</div>
      ${S.chats.map((c) => `
        <button class="row card" data-open="${esc(c.chatId)}">
          <span class="ava">${esc((c.title || '?')[0])}</span>
          <span class="row-main">
            <span class="row-title">${esc(c.title || 'Без названия')}</span>
            <span class="row-sub">${fmt(c.stats.total)} сообщений в архиве</span>
          </span>
          <span class="row-side">
            ${c.stats.deleted ? `<span class="tag red">${c.stats.deleted}</span>` : ''}
            ${c.viaBusiness ? '<span class="tag biz">личный</span>'
              : c.botIsAdmin ? '' : '<span class="tag warn">не админ</span>'}
          </span>
        </button>
      `).join('')}
      ${addBotLink()
        ? `<a class="btn-ghost" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot>+ Подключить ещё чат</a>`
        : ''}
    `}
  `;
}

function ChatScreen() {
  const c = S.chat;
  const filters = [['all', 'Все'], ['deleted', 'Удалённые'], ['edited', 'Изменённые'], ['media', 'Медиа']];
  return `
    <div class="chatbar">
      <button class="back" data-back>‹</button>
      <div class="chatbar-main">
        <div class="chatbar-title">${esc(c.title || 'Чат')}</div>
        <div class="chatbar-sub">${fmt(c.stats.total)} сообщений</div>
      </div>
    </div>
    <div class="filters">
      ${filters.map(([k, l]) => `<button class="chip ${S.chatFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    ${S.loading ? spinner() : S.messages.length === 0
      ? `<div class="empty">Здесь пока пусто. Как только в чате появятся сообщения, они сохранятся сюда.</div>`
      : S.messages.map((m) => `
        <div class="msg card ${m.isDeleted ? 'del' : ''}">
          <div class="msg-head">
            <span class="msg-who">${esc(m.senderName || 'Кто-то')}</span>
            ${m.isDeleted ? '<span class="tag red">удалено</span>' : ''}
            ${m.isEdited ? '<span class="tag violet">изменено</span>' : ''}
          </div>
          <div class="msg-text">${m.mediaType ? `[${esc(m.mediaType)}]` : esc(m.text || '')}</div>
          <div class="msg-time">${new Date(m.sentAt).toLocaleString('ru-RU')}</div>
        </div>
      `).join('')}
  `;
}

const spinner = () => `<div class="spinner"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
const errorBox = (msg) => `<div class="err">Не удалось загрузить: ${esc(msg)}<br><button class="btn-ghost" data-retry>Повторить</button></div>`;

function render() {
  const app = $('app');
  app.innerHTML = S.tab === 'chat' ? ChatScreen() : ChatsScreen();
}

// ─── события ───
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { openChat(open.dataset.open); return; }
  if (e.target.closest('[data-back]')) { S.tab = 'chats'; S.chat = null; render(); return; }
  const f = e.target.closest('[data-filter]');
  if (f) { setFilter(f.dataset.filter); return; }
  if (e.target.closest('[data-retry]')) { loadChats(); return; }

  // Добавление бота: внутри Telegram открываем нативно, чтобы не уходить в браузер.
  const add = e.target.closest('[data-addbot]');
  if (add && tg?.openTelegramLink) {
    e.preventDefault();
    tg.openTelegramLink(add.getAttribute('href'));
    return;
  }
});

// ─── старт ───
if (tg) { tg.ready(); tg.expand(); }
if (!initData) {
  $('app').innerHTML = `<div class="err">Откройте приложение внутри Telegram — вне его нет данных авторизации.</div>`;
} else {
  // Имя бота и список чатов грузим параллельно; кнопка добавления оживёт,
  // как только придёт username (render вызывается в loadChats).
  loadBotUsername().then(render);
  loadChats();
}
