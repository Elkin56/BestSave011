// public/app.js — BestSave, полная версия на реальных данных.
// Все цифры приходят с сервера и посчитаны по вашему архиву.
// Ничего не выдумывается: если данных нет — экран честно об этом говорит.

const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const fmt = (n) => Math.trunc(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
const $ = (id) => document.getElementById(id);

async function api(path) {
  const r = await fetch(path, {
    headers: { 'content-type': 'application/json', authorization: 'tma ' + initData },
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.reason || b.error || `HTTP ${r.status}`);
  }
  return r.json();
}

const S = {
  tab: 'home',
  prevTab: 'home',        // куда возвращаться из настроек/уведомлений
  botUsername: null,
  loading: true,
  error: null,
  stats: null,
  chats: [],
  chatSearch: '',         // поиск по чатам
  businessConnected: false,
  chat: null, chatTab: 'deleted', messages: [], chatLoading: false,
  msgSearch: '',          // поиск внутри чата
  activity: null,
  events: null,
  me: null,
  resourceToken: null,
  settings: null,         // { notifyDeleted, notifyEdited, notifyFake }
  admin: null,            // метрики владельца (только если isAdmin)
  isAdmin: false,
  aiTab: 0,
};

// URL для <img>/<audio>/скачивания, где заголовок не поставить.
// В адрес идёт короткоживущий токен из /api/me, а НЕ initData:
// initData живёт сутки и не должен оседать в логах и истории.
const authUrl = (path, params = {}) => {
  const u = new URLSearchParams({ ...params, t: S.resourceToken || '' });
  return `${path}?${u.toString()}`;
};

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'tma ' + initData },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(b.reason || b.error || `HTTP ${r.status}`);
  }
  return r.json();
}

/* ── иконки ── */
const I = {
  shield:'<path d="M12 3l7 3v6c0 4.5-3 8.3-7 9-4-.7-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  bell:'<path d="M18 9a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9z"/><path d="M10 21a2 2 0 004 0"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  home:'<path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-8z"/>',
  chat:'<path d="M4 5h16v11H8l-4 4V5z"/>',
  bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  ai:'<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-6 7-6s7 2 7 6"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  pencil:'<path d="M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  arrow:'<path d="M9 6l6 6-6 6"/>',
  back:'<path d="M15 6l-6 6 6 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fire:'<path d="M12 3s5 4 5 9a5 5 0 01-10 0c0-2 1-3 1-3s0 2 1.5 2S12 3 12 3z"/>',
  moon:'<path d="M20 14a8 8 0 01-10-10 8 8 0 1010 10z"/>',
  check:'<path d="M5 12l5 5L20 7"/>',
  tg:'<path d="M21 4L2.5 11.2l5.6 1.9L19 6.5l-8.4 8.1.3 5.9 3-3.6 4.4 3.2z"/>',
  plug:'<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0z"/><path d="M12 18v4"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  refresh:'<path d="M21 12a9 9 0 11-3-6.7M21 3v6h-6"/>',
  doc:'<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/>',
  download:'<path d="M12 3v11M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  alert:'<path d="M12 3l9 16H3z"/><path d="M12 9v5M12 17h.01"/>',
  pin:'<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>',
};
const sv = (n, s, c, w) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="${c}" stroke-width="${w||2}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${I[n]||''}</svg>`;

const COLORS = { gold:'var(--gold)', green:'var(--green)', red:'var(--red)', violet:'var(--violet)', blue:'var(--blue)' };

/* ── анимации визуального слоя (логику не трогают) ──
   Уважают prefers-reduced-motion: при нём числа ставятся сразу. */
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Плавный «живой» счётчик: число доезжает до цели с ослаблением.
function animateCount(el) {
  const target = Number(el.dataset.count) || 0;
  if (reduceMotion || target === 0) { el.textContent = fmt(target); return; }
  const dur = 900, start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = fmt(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Каскадное появление карточек: назначаем задержки уже отрисованным узлам.
function applyStagger(root) {
  if (reduceMotion) return;
  const items = root.querySelectorAll('[data-stagger]');
  items.forEach((el, i) => {
    el.style.animationDelay = Math.min(i * 55, 400) + 'ms';
    el.classList.add('stagger');
  });
}

// Запускаем все счётчики и каскад после отрисовки экрана.
function runEntrance(root) {
  root.querySelectorAll('[data-count]').forEach(animateCount);
  applyStagger(root);
}

/* ── загрузка ── */
async function loadAll() {
  S.loading = true; S.error = null; render();
  try {
    const [stats, chats, me] = await Promise.all([
      api('/api/stats'), api('/api/chats'), api('/api/me'),
    ]);
    S.stats = stats;
    S.chats = chats.chats || [];
    S.businessConnected = Boolean(chats.businessConnected);
    S.me = me;
    S.resourceToken = me.resourceToken || null;
    S.isAdmin = Boolean(me.isAdmin);
  } catch (e) { S.error = e.message; }
  finally { S.loading = false; render(); }
}

async function loadEvents() {
  if (S.events) return;
  try { S.events = await api('/api/events'); render(); }
  catch (e) { S.events = { cards: [], error: e.message }; render(); }
}

async function loadBot() {
  try { const i = await api('/api/bot-info'); if (i?.username) S.botUsername = i.username; }
  catch {}
}

async function openChat(id) {
  S.chat = S.chats.find((c) => c.chatId === id);
  S.tab = 'chatview'; S.chatTab = 'deleted'; S.messages = []; S.activity = null; S.msgSearch = '';
  S.chatLoading = true; render();
  await loadMessages();
}

async function loadMessages() {
  S.chatLoading = true; render();
  try {
    // voices теперь фильтруется на сервере — раньше клиент отбрасывал часть
    // выдачи уже после пагинации, из-за чего страница могла прийти полупустой
    const params = new URLSearchParams({
      chatId: S.chat.chatId,
      filter: S.chatTab,
    });
    if (S.msgSearch.trim()) params.set('q', S.msgSearch.trim());
    const d = await api(`/api/messages?${params.toString()}`);
    let list = d.messages || [];
    if (S.chatTab === 'media') list = list.filter((m) => !['voice','video_note'].includes(m.mediaType));
    S.messages = list;
  } catch (e) { S.error = e.message; }
  finally { S.chatLoading = false; render(); }
}

// Закрепить / открепить. Состояние меняем сразу, чтобы отклик был мгновенным,
// и откатываем, если сервер отказал.
async function togglePin(msgId) {
  const m = S.messages.find((x) => x.id === msgId);
  if (!m) return;
  const next = !m.isPinned;
  m.isPinned = next;
  render();
  try {
    await apiPost('/api/pin', { msgId, pinned: next });
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch {
    m.isPinned = !next; // откат
    render();
  }
}

const addBotLink = () => S.botUsername
  ? `https://t.me/${encodeURIComponent(S.botUsername)}?startgroup=archive` : null;

// Активность считается на сервере; фильтр берём тот же, что и в списке,
// чтобы графики отвечали выбранной вкладке.
async function loadActivity() {
  S.activity = null;
  render();
  try {
    const tz = new Date().getTimezoneOffset();
    // Для вкладки «Активность» показываем весь чат: свой фильтр у неё нет
    S.activity = await api(`/api/activity?chatId=${encodeURIComponent(S.chat.chatId)}&tz=${tz}`);
  } catch (e) {
    S.activity = { total: 0 };
  }
  render();
}

async function loadSettings() {
  if (S.settings) return;
  try { S.settings = await api('/api/settings'); render(); }
  catch { S.settings = { notifyDeleted: true, notifyEdited: false, notifyFake: true, offline: true }; render(); }
}

async function toggleSetting(key) {
  if (!S.settings) return;
  S.settings[key] = !S.settings[key];
  render();
  try {
    // Пояс отправляем всегда: сервер считает «ночь» по нему, а устройство
    // может переехать в другую зону между сессиями.
    S.settings = await apiPost('/api/settings', {
      ...S.settings,
      tzOffsetMin: -new Date().getTimezoneOffset(),
    });
  }
  catch { /* оставляем локально, сохранится при следующем изменении */ }
  render();
}

// Скачивание чата: автономный HTML с сообщениями, фото и голосовыми.
// В новых клиентах Telegram — нативное окно загрузки, иначе открываем ссылку.
function downloadChat(chatId) {
  const chat = S.chats.find((c) => c.chatId === chatId) || S.chat;
  const url = location.origin + authUrl('/api/export', { chatId });
  const fileName = `BestSave — ${(chat?.title || 'чат').slice(0, 40)}.html`;
  if (tg?.downloadFile) {
    try { tg.downloadFile({ url, file_name: fileName }, () => {}); return; } catch {}
  }
  window.open(url, '_blank');
}

/* ── общие куски ── */
const spinner = () => `<div class="spinner"><i></i><i></i><i></i></div>`;
const errBox = (m) => `<div class="err">Не удалось загрузить: ${esc(m)}
  <button class="btn-ghost" data-reload style="margin-top:12px">Повторить</button></div>`;

function topBar() {
  const titles = { home:'BestSave', chats:'Чаты', events:'События', ai:'AI Анализ',
    profile:'Профиль', settings:'Настройки', notifications:'Уведомления',
    privacy:'Конфиденциальность', admin:'Панель владельца' };

  if (S.tab === 'chatview' && S.chat) {
    return `<button class="icon-btn" data-tab="chats">${sv('back',17,'var(--txt-lo)')}</button>
      <div style="flex:1;min-width:0">
        <div class="brand" style="font-size:15px">${esc(S.chat.title || 'Чат')}</div>
        <div style="font-size:10.5px;color:var(--txt-lo);font-variant-numeric:tabular-nums">${fmt(S.chat.stats.total)} в архиве</div>
      </div>
      <button class="icon-btn" data-export="${esc(S.chat.chatId)}" title="Скачать чат">${sv('download',16,'var(--green)')}</button>`;
  }

  if (['settings','notifications','privacy','admin'].includes(S.tab)) {
    return `<button class="icon-btn" data-tab="${esc(S.prevTab)}">${sv('back',17,'var(--txt-lo)')}</button>
      <div style="flex:1"><div class="brand">${titles[S.tab]}</div></div>`;
  }

  return `<div class="logo"><img src="/cat.jpg" alt="" width="38" height="38"></div>
    <div style="flex:1"><div class="brand">${titles[S.tab] || 'BestSave'}</div></div>
    <button class="icon-btn ${S.tab==='notifications'?'':''}" data-tab="notifications" title="Уведомления">${sv('bell',16,'var(--txt-lo)')}</button>
    <button class="icon-btn" data-tab="settings" title="Настройки">${sv('gear',16,'var(--txt-lo)')}</button>
    <button class="icon-btn" data-reload>${sv('refresh',16,'var(--txt-lo)')}</button>`;
}

/* ── Главная ── */
function Home() {
  const t = S.stats?.totals || {};
  const stat = (ic, grad, label, n) => `<div class="stat" data-stagger>
    <div class="head"><span class="chip" style="width:26px;height:26px;background:${grad}">${sv(ic,13,'#fff',2.4)}</span>${label}</div>
    <div class="num" data-count="${n||0}">0</div></div>`;

  const empty = !t.total;
  return `
    <div class="hero" data-stagger>
      <div class="hero-glow"></div>
      <img class="cat" src="/cat.jpg" width="520" height="620" decoding="async" alt="BestSave">
      <div class="hero-title">${S.businessConnected ? 'Под защитой' : 'BestSave'}</div>
      ${S.businessConnected
        ? `<div class="ok-badge">${sv('check',15,'#0B3B2E',3)} Личные чаты подключены</div>`
        : `<div class="hero-sub">Подключите архив, чтобы начать</div>`}
    </div>

    ${empty ? `
      <div class="card" style="margin:16px;padding:22px" data-stagger>
        <div style="font-size:16px;font-weight:900;margin-bottom:10px;font-family:'Nunito'">Архив пока пуст</div>
        <div class="note">
          Сообщения появятся здесь, как только придут <b style="color:var(--txt)">новые</b> —
          Telegram не даёт ботам выгружать прошлую переписку.
        </div>
      </div>` : `
      <div class="balance" data-stagger>
        <div class="balance-orb">${sv('shield',26,'#04231A',2.4)}</div>
        <div>
          <div class="balance-label">СОХРАНЕНО СООБЩЕНИЙ</div>
          <div class="balance-num" data-count="${t.total||0}">0</div>
        </div>
        <div class="balance-meta">${S.stats.chats}<br>${S.stats.chats===1?'чат':'чатов'}</div>
      </div>

      <div class="grid2" style="margin-top:12px">
        ${stat('trash','var(--g-pink)','Удалено', t.deleted)}
        ${stat('pencil','var(--g-purple)','Изменено', t.edited)}
        ${stat('image','var(--g-cyan)','Медиа', t.media)}
        ${stat('mic','var(--g-orange)','Голосовые', t.voices)}
      </div>`}

    <div class="sec">Быстрый доступ</div>
    <div class="grid2">
      ${[['chat','Чаты','chats','var(--g-purple)'],['bolt','События','events','var(--g-orange)'],
         ['ai','AI Анализ','ai','var(--g-cyan)'],['user','Профиль','profile','var(--g-green)']]
        .map(([ic,l,go,grad]) => `<button class="card qa" data-tab="${go}" data-stagger>
          <span class="chip" style="width:38px;height:38px;border-radius:13px;background:${grad}">${sv(ic,17,'#fff',2.3)}</span>
          <span style="font-size:14.5px;font-weight:800;font-family:'Nunito'">${l}</span></button>`).join('')}
    </div>

    ${S.stats?.activity?.length ? `
      <div class="sec">Последняя активность</div>
      <div class="card" style="margin:0 16px;overflow:hidden" data-stagger>
        ${S.stats.activity.map((a,i) => `${i?'<div class="div"></div>':''}
          <div class="row">
            <span class="ava" style="width:40px;height:40px;font-size:15px">${esc((a.who||'?')[0])}</span>
            <span class="row-main">
              <span class="row-title">${esc(a.who)}</span>
              <span style="display:block;font-size:12px;color:var(--${a.tone});margin-top:2px;font-weight:700">${a.what}</span>
            </span>
            <span style="font-size:11px;color:var(--txt-dim);font-weight:700">${timeAgo(a.at)}</span>
          </div>`).join('')}
      </div>` : ''}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 3600) return Math.max(1, Math.round(diff/60)) + ' мин';
  if (diff < 86400) return Math.round(diff/3600) + ' ч';
  if (diff < 172800) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day:'numeric', month:'short' });
}

/* ── Чаты ── */
function Chats() {
  if (!S.chats.length) {
    return `<div class="card connect" style="margin:16px">
      ${S.businessConnected
        ? `<div class="ok-badge">✅ Бизнес-подключение активно</div>
           <div class="note" style="margin-top:14px;font-size:13px;line-height:1.6">
             Слежу за вашими личными чатами. Чат появится здесь, когда в нём придёт
             <b style="color:var(--txt)">новое сообщение</b> — прошлую переписку Telegram
             выгружать не даёт.
           </div>`
        : `<div class="connect-title">💬 Личные чаты</div>
           <div class="connect-step"><span class="step-num">1</span> Настройки → Telegram Business → Чат-боты</div>
           <div class="connect-step"><span class="step-num">2</span> Впишите ${S.botUsername ? '@'+esc(S.botUsername) : 'бота'}</div>
           <div class="note">Нужен Telegram Premium.</div>`}
      <button class="btn-green" data-reload style="margin-top:16px">Обновить</button>
      ${addBotLink() ? `<a class="btn-ghost" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot style="margin-top:8px">Добавить бота в группу</a>` : ''}
    </div>`;
  }

  const query = S.chatSearch.trim().toLowerCase();
  const list = query
    ? S.chats.filter((c) => (c.title || '').toLowerCase().includes(query))
    : S.chats;

  return `
    <div class="search">
      ${sv('search',15,'var(--txt-lo)')}
      <input id="chat-search" type="search" placeholder="Поиск по чатам" value="${esc(S.chatSearch)}"
        autocomplete="off" enterkeyhint="search">
      ${S.chatSearch ? `<button class="icon-btn" data-clear-search style="width:26px;height:26px;border:none;background:none">✕</button>` : ''}
    </div>

    <div class="sec">${query ? `Найдено · ${list.length}` : `Подключено · ${S.chats.length}`}</div>
    ${!list.length ? `<div class="empty">По запросу «${esc(S.chatSearch)}» чатов не нашлось.</div>` : `
    <div class="card" style="margin:0 16px;overflow:hidden" data-stagger>
      ${list.map((c,i) => `${i?'<div class="div"></div>':''}
        <button class="row" data-open="${esc(c.chatId)}" style="width:100%;text-align:left">
          ${chatAvatar(c)}
          <span class="row-main">
            <span class="row-title">${esc(c.title || 'Без названия')}</span>
            <span class="row-sub">
              ${c.stats.deleted ? `<span class="tag red">${sv('trash',10,'currentColor',2.2)}${fmt(c.stats.deleted)}</span>` : ''}
              ${c.stats.edited ? `<span class="tag violet">${sv('pencil',10,'currentColor',2.2)}${fmt(c.stats.edited)}</span>` : ''}
              ${c.viaBusiness ? '<span class="tag biz">личный</span>' : ''}
              ${!c.stats.deleted && !c.stats.edited && !c.viaBusiness ? 'сообщения в архиве' : ''}
            </span>
          </span>
          <span class="row-side">
            <span class="count-pill" title="Всего сообщений в архиве">${fmt(c.stats.total)}</span>
            ${sv('arrow',13,'var(--txt-dim)')}
          </span>
        </button>`).join('')}
    </div>`}
    ${addBotLink() ? `<a class="btn-ghost" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot style="margin:12px 16px 0">+ Подключить группу</a>` : ''}`;
}

// Пять запасных градиентов: если фото нет, чаты всё равно различаются
// цветом, а не сливаются в одинаковые фиолетовые квадраты.
const AVA_TINTS = ['var(--g-purple)','var(--g-cyan)','var(--g-orange)','var(--g-green)','var(--g-pink)'];
const tintFor = (key) => {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVA_TINTS[h % AVA_TINTS.length];
};

// Аватар чата: настоящее фото из Telegram поверх цветной подложки с буквой.
// Не загрузилось (нет фото, скрыто приватностью) — <img> убирается,
// остаётся буква.
function chatAvatar(c) {
  const letter = esc((c.title || '?')[0]);
  const src = authUrl('/api/avatar', { chat: c.chatId });
  return `<span class="ava" style="background:${tintFor(c.chatId)}">
    <img src="${src}" alt="" loading="lazy" onerror="this.remove()">${letter}</span>`;
}

/* ── Чат внутри ── */
// Аватар собеседника у сообщения: реальное фото из профиля Telegram.
// Тянется через /api/avatar?peer=<id> — бот берёт фото по id отправителя,
// доступ проверяется по принадлежности к архиву. Если фото скрыто или id
// нет — показывается буква на цветной подложке.
function msgAvatar(m) {
  const letter = esc((m.senderName || '?')[0]);
  if (!m.senderId) {
    return `<span class="msg-ava">${letter}</span>`;
  }
  const src = authUrl('/api/avatar', { peer: m.senderId });
  return `<span class="msg-ava"><img src="${src}" alt="" loading="lazy"
    onerror="this.remove()">${letter}</span>`;
}

// Вложение сообщения. Файлы (в т.ч. УДАЛЁННЫХ сообщений) отдаёт /api/media:
// бот сохранил file_id в момент получения, поэтому фото и голосовые
// открываются даже после удаления в самом Telegram.
function mediaBlock(m) {
  if (!m.mediaType) return '';
  if (!m.hasMedia) {
    return `<div class="media-miss">${mediaLabel(m.mediaType)} — файл не сохранён:
      сообщение попало в архив до обновления с поддержкой файлов.</div>`;
  }
  const src = authUrl('/api/media', { chatId: S.chat.chatId, msgId: m.id });
  if (m.mediaType === 'photo' || m.mediaType === 'sticker') {
    return `<div class="msg-media"><img src="${src}" alt="${esc(mediaLabel(m.mediaType))}" loading="lazy"
      onerror="this.outerHTML='<div class=&quot;media-miss&quot;>Не удалось загрузить файл</div>'"></div>`;
  }
  if (m.mediaType === 'voice') {
    return `<div class="msg-media"><audio controls preload="none" src="${src}"></audio></div>`;
  }
  if (m.mediaType === 'video_note') {
    return `<div class="msg-media"><video class="round" controls preload="none" src="${src}"></video></div>`;
  }
  if (m.mediaType === 'video' || m.mediaType === 'animation') {
    return `<div class="msg-media"><video controls preload="none" src="${src}"></video></div>`;
  }
  return `<div class="msg-media"><a class="btn-ghost" href="${src}" target="_blank" rel="noopener"
    style="padding:9px 13px;display:inline-flex">${mediaLabel(m.mediaType)} · открыть</a></div>`;
}

// Предупреждение фейк-контроля под сообщением.
// Формулировка нейтральная: повтор файла — факт, умысел — предположение.
function fakeBlock(m) {
  if (m.repeatOfAt) {
    return `<div class="fake">${sv('alert',13,'#ffb020')}<span>Этот же файл уже был в архиве —
      ${new Date(m.repeatOfAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}.
      Запись не новая.</span></div>`;
  }
  if (m.origSentAt) {
    return `<div class="fake">${sv('alert',13,'#ffb020')}<span>Переслано. Оригинал отправлен
      ${new Date(m.origSentAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}.</span></div>`;
  }
  return '';
}

/* ── Графики активности ── */
function barChart(values, labels, title, sumText) {
  const max = Math.max(...values, 1);
  const peak = values.indexOf(max);
  return `<div class="chart" data-stagger>
    <h4>${title}</h4>
    <div class="bars">
      ${values.map((v,i) => `<div class="bar ${v===0?'zero':i===peak?'peak':''}"
        style="height:${Math.max(2, Math.round(v / max * 100))}%;transition-delay:${Math.min(i*14,340)}ms"
        title="${labels[i]}: ${fmt(v)}"></div>`).join('')}
    </div>
    <div class="xlab">${labels.map((l,i) =>
      `<span>${labels.length > 12 && i % 3 !== 0 ? '' : l}</span>`).join('')}</div>
    ${sumText ? `<div class="chart-sum">${sumText}</div>` : ''}
  </div>`;
}

function ActivityView() {
  const a = S.activity;
  if (!a) return spinner();
  if (!a.total) return `<div class="empty">За выбранным фильтром сообщений нет — графики строить не из чего.</div>`;

  const hourLabels = Array.from({length:24}, (_,i) => String(i).padStart(2,'0'));
  const wdLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  const peakHour = a.hours.indexOf(Math.max(...a.hours));
  const peakWd = a.weekdays.indexOf(Math.max(...a.weekdays));
  const night = a.hours.slice(0,6).reduce((x,y)=>x+y,0);
  const nightPct = Math.round(night / a.total * 100);

  const dayValues = a.daily.map((d) => d.count);
  const dayLabels = a.daily.map((d) => {
    const dt = new Date(d.day);
    return dt.getDate() === 1 || dt.getDay() === 1 ? String(dt.getDate()) : '';
  });

  return `
    ${barChart(a.hours, hourLabels, 'По часам суток',
      `Пик — ${String(peakHour).padStart(2,'0')}:00. Ночью (00–06) — ${fmt(night)}, это ${nightPct}%.`)}
    ${barChart(a.weekdays, wdLabels, 'По дням недели',
      `Больше всего — ${wdLabels[peakWd]}.`)}
    ${barChart(dayValues, dayLabels, `За последние ${a.windowDays} дней`,
      `Всего за период — ${fmt(dayValues.reduce((x,y)=>x+y,0))} из ${fmt(a.total)}.`)}
    <div class="note" style="margin:0 16px">Время показано в вашем часовом поясе.
      Считаются только сообщения вашего архива.</div>`;
}

function ChatView() {
  const tabs = [['deleted','Удалённые'],['pinned','Закреплённые'],['media','Медиа'],
    ['voices','Голосовые'],['edited','Изменённые'],['all','Все'],['activity','Активность']];

  // Подсветка совпадений: экранируем текст, потом оборачиваем найденное.
  // Порядок важен — иначе разметка подсветки сама стала бы уязвимостью.
  const highlight = (text) => {
    const safe = esc(text);
    const qq = S.msgSearch.trim();
    if (!qq) return safe;
    const rx = new RegExp('(' + esc(qq).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(rx, '<mark>$1</mark>');
  };

  const body = () => {
    if (S.chatTab === 'activity') return ActivityView();
    if (S.chatLoading) return spinner();
    if (!S.messages.length) {
      if (S.msgSearch.trim()) {
        return `<div class="empty">По запросу «${esc(S.msgSearch)}» ничего не нашлось.<br>
          Поиск идёт по тексту сообщений выбранной вкладки.</div>`;
      }
      return `<div class="empty">${S.chatTab === 'pinned'
        ? 'Закреплённых пока нет.<br>Нажмите на кнопку с булавкой у важного сообщения — оно окажется здесь.'
        : 'Здесь пока пусто.'}</div>`;
    }
    return S.messages.map((m) => `
      <div class="card msg ${m.isDeleted?'del':''} ${m.isPinned?'pinned':''}" style="margin:0 16px 8px;padding:13px">
        <div class="msg-head">
          ${msgAvatar(m)}
          <span class="msg-who">${esc(m.senderName || 'Кто-то')}</span>
          <time style="font-size:10.5px;color:var(--txt-lo)">${new Date(m.sentAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time>
          <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
            ${m.isDeleted?'<span class="tag red">удалено</span>':''}
            ${m.isEdited && !m.isDeleted?'<span class="tag violet">изменено</span>':''}
            <button class="pin-btn ${m.isPinned?'on':''}" data-pin="${m.id}"
              title="${m.isPinned?'Открепить':'Закрепить'}">${sv('pin',14,m.isPinned?'#fff':'var(--txt-dim)',2.2)}</button>
          </span>
        </div>
        ${m.text ? `<div class="msg-text">${highlight(m.text)}</div>` : ''}
        ${!m.text && !m.mediaType ? '<div class="msg-text">—</div>' : ''}
        ${mediaBlock(m)}
        ${fakeBlock(m)}
      </div>`).join('');
  };

  // Поиск скрываем на вкладке активности: там искать нечего
  const searchBox = S.chatTab === 'activity' ? '' : `
    <div class="search" style="margin-top:12px">
      ${sv('search',15,'var(--txt-lo)')}
      <input id="msg-search" type="search" placeholder="Поиск по сообщениям"
        value="${esc(S.msgSearch)}" autocomplete="off" enterkeyhint="search">
      ${S.msgSearch ? `<button class="icon-btn" data-clear-msgsearch style="width:26px;height:26px;border:none;background:none">✕</button>` : ''}
    </div>`;

  return `<div class="filters">
      ${tabs.map(([k,l]) => `<button class="chip-btn ${S.chatTab===k?'on':''}" data-ctab="${k}">${l}</button>`).join('')}
    </div>
    ${searchBox}
    <div style="margin-top:14px">${body()}</div>
    ${!S.chatLoading && S.chatTab !== 'activity' ? `<button class="btn-ghost" data-export="${esc(S.chat.chatId)}" style="margin:6px 16px 0;width:calc(100% - 32px)">
      ${sv('download',15,'var(--green)')} Скачать чат файлом (сообщения + фото + голосовые)</button>` : ''}`;
}

const mediaLabel = (t) => ({
  photo:'📷 Фото', video:'🎬 Видео', voice:'🎤 Голосовое',
  video_note:'⭕ Кружок', document:'📎 Файл', animation:'🎞 GIF', sticker:'🩵 Стикер',
}[t] || '📎 Вложение');

/* ── События ── */
function Events() {
  if (!S.events) { loadEvents(); return spinner(); }
  if (S.events.error) return errBox(S.events.error);

  if (!S.events.cards.length) {
    return `<div class="card" style="margin:16px;padding:20px">
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">Пока считать нечего</div>
      <div class="note">
        В архиве ${fmt(S.events.totalMessages)} ${S.events.totalMessages === 1 ? 'сообщение' : 'сообщений'}.
        События появятся, когда данных станет больше: нужен хотя бы десяток сообщений
        за несколько дней, иначе статистика ничего не значит.
        <br><br>
        Здесь показывается только реально посчитанное по вашему архиву — выдуманных цифр нет.
      </div>
    </div>`;
  }

  return `<div class="sec" style="margin-top:16px">
      ${sv('bolt',13,'var(--green)')} Сегодня в архиве
      <span style="margin-left:auto;font-weight:600;font-size:11px">обновится завтра</span>
    </div>
    ${S.events.cards.map((e) => {
      const c = COLORS[e.color] || 'var(--green)';
      const head = `<div class="ev-head">
        <span class="chip" style="width:30px;height:30px;border-radius:10px;background:${c}1A;border:1px solid ${c}44">${sv(e.icon,15,c,2.2)}</span>
        <span style="font-size:13.5px;font-weight:800">${esc(e.title)}</span>
        ${e.chat?`<span style="margin-left:auto;font-size:10.5px;color:var(--txt-lo)">${esc(e.chat)}</span>`:''}
      </div>`;
      if (e.kind === 'first') return `<div class="card ev" data-stagger>
        ${head}<div style="font-size:11px;color:var(--txt-lo);margin-bottom:11px">${esc(e.date||'')}</div>
        ${e.lines.map(([l,v],i)=>`<div class="ev-line" style="${i?'border-top:1px solid var(--line)':''}">
          <span style="font-size:11.5px;color:var(--txt-lo);width:120px;flex-shrink:0">${esc(l)}</span>
          <span style="flex:1;font-size:12.5px;font-weight:600;min-width:0">${esc(v)}</span></div>`).join('')}
      </div>`;
      return `<div class="card ev" data-stagger>
        ${head}
        ${e.date?`<div style="font-size:11px;color:var(--txt-lo);margin-bottom:7px">${esc(e.date)}</div>`:''}
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <span style="font-size:${String(e.big).length>10?20:28}px;font-weight:800;letter-spacing:-.8px;color:${c}">${esc(e.big)}</span>
          ${e.delta?`<span class="delta">${esc(e.delta)}</span>`:''}
        </div>
        <div style="font-size:12px;color:var(--txt-lo);margin-top:6px">${esc(e.label)}</div>
        ${e.sub?`<div class="ev-sub">${esc(e.sub)}</div>`:''}
      </div>`;
    }).join('')}
    <div class="note" style="margin:16px">
      Подборка пересобирается раз в сутки из вашего архива. В течение дня не меняется —
      чтобы можно было вернуться к тому, что видели утром.
    </div>`;
}

/* ── AI (заглушка) ── */
function AI() {
  return `<div class="card" style="margin:16px;padding:22px;text-align:center">
      <span class="chip" style="width:52px;height:52px;border-radius:16px;margin:0 auto 14px;background:var(--green-soft);border:1px solid var(--green-line)">
        ${sv('ai',24,'var(--green)')}</span>
      <div style="font-size:17px;font-weight:800">AI-анализ скоро</div>
      <div class="note" style="margin-top:10px">
        Разбор переписки по темам, тональности и динамике требует внешней языковой модели —
        это платно за каждый запрос. Пока приложение бесплатное, вкладка отключена.
      </div>
    </div>

    <div class="sec">Что здесь появится</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      ${[['Сводка переписки','о чём общаетесь и как'],
         ['Темы','распределение по темам с процентами'],
         ['Тональность','тон текста по каждому собеседнику'],
         ['Динамика','кто пишет первым, медианы ответов'],
         ['Агент','вопросы к своему архиву на обычном языке']]
        .map(([t,d],i)=>`${i?'<div class="div"></div>':''}
        <div class="row">
          <span class="chip" style="width:28px;height:28px;border-radius:9px;background:var(--surf-hi)">${sv('lock',13,'var(--txt-lo)')}</span>
          <span class="row-main"><span class="row-title">${t}</span><span class="row-sub">${d}</span></span>
        </div>`).join('')}
    </div>

    <div class="note" style="margin:14px 16px">
      Важно: даже когда AI появится, он не будет делать выводов о чувствах собеседника.
      По тексту это установить нельзя — можно показать только факты переписки.
    </div>`;
}

/* ── Профиль ── */
function Profile() {
  const me = S.me;
  if (!me) return spinner();
  const u = me.user, a = me.archive;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Пользователь';

  return `<div style="display:flex;align-items:center;gap:14px;padding:16px">
      <div style="position:relative;flex-shrink:0">
        <div class="ava-ring">
          <img src="${u.photoUrl ? esc(u.photoUrl) : authUrl('/api/avatar')}" alt=""
            style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="ava-letter" style="display:none">${esc(name[0])}</div>
        </div>
        <span class="tg-badge" title="Из Telegram">${sv('tg',12,'#fff',2.2)}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:19px;font-weight:800;letter-spacing:-.4px">${esc(name)}</div>
        ${u.username?`<div style="font-size:12.5px;color:var(--txt-lo);margin-top:1px">@${esc(u.username)}</div>`:''}
        ${u.isPremium?`<span class="tag gold" style="margin-top:6px;display:inline-block">Telegram Premium</span>`:''}
      </div>
    </div>
    <div class="note" style="margin:0 16px">Имя и аватар берутся из Telegram — отдельно загружать не нужно.</div>

    <div class="sec">Ваш архив</div>
    <div class="grid2">
      <div class="stat" data-stagger><div class="head"><span class="chip" style="width:24px;height:24px;background:var(--g-purple)">${sv('chat',12,'#fff',2.4)}</span>Чатов</div><div class="num" data-count="${a.chats}">0</div></div>
      <div class="stat" data-stagger><div class="head"><span class="chip" style="width:24px;height:24px;background:var(--g-cyan)">${sv('doc',12,'#fff',2.4)}</span>Сообщений</div><div class="num" data-count="${a.messages}">0</div></div>
      <div class="stat" data-stagger><div class="head"><span class="chip" style="width:24px;height:24px;background:var(--g-pink)">${sv('shield',12,'#fff',2.4)}</span>Спасено удалённых</div><div class="num" data-count="${a.deleted}">0</div></div>
      <div class="stat" data-stagger><div class="head"><span class="chip" style="width:24px;height:24px;background:var(--g-green)">${sv('clock',12,'#fff',2.4)}</span>Архив с</div><div class="num" style="font-size:17px;-webkit-text-fill-color:#F4F1FF;background:none">${a.since?new Date(a.since).toLocaleDateString('ru-RU'):'—'}</div></div>
    </div>

    <div class="sec">Подключение</div>
    <div class="card" style="margin:0 16px;padding:15px;display:flex;align-items:center;gap:12px">
      <span class="chip" style="width:38px;height:38px;border-radius:12px;background:${me.business.connected?'var(--green-soft)':'var(--surf-hi)'};border:1px solid ${me.business.connected?'var(--green-line)':'var(--line)'}">
        ${sv('plug',17,me.business.connected?'var(--green)':'var(--txt-lo)')}</span>
      <span style="flex:1">
        <span style="display:block;font-size:14px;font-weight:700">Личные чаты</span>
        <span style="display:block;font-size:11.5px;color:var(--txt-lo);margin-top:2px">
          ${me.business.connected ? 'Telegram Business подключён' : 'не подключено'}</span>
      </span>
      ${me.business.connected?`<span style="width:22px;height:22px;border-radius:50%;background:var(--green-soft);border:1px solid var(--green-line);display:flex;align-items:center;justify-content:center">${sv('check',12,'var(--green)',3)}</span>`:''}
    </div>

    <div class="sec">Тариф</div>
    <div class="card" style="margin:0 16px;padding:16px">
      <div style="display:flex;align-items:center;gap:12px">
        <span class="chip" style="width:40px;height:40px;border-radius:12px;background:var(--green-soft);border:1px solid var(--green-line)">${sv('shield',18,'var(--green)')}</span>
        <span style="flex:1">
          <span style="display:block;font-size:15.5px;font-weight:800">${esc(me.plan.name)}</span>
          <span style="display:block;font-size:11.5px;color:var(--txt-lo);margin-top:2px">Все функции доступны без оплаты</span>
        </span>
      </div>
      <div class="div" style="margin:14px 0"></div>
      <div style="display:flex;align-items:baseline">
        <span style="flex:1;font-size:13px;color:var(--txt-lo)">Баланс</span>
        <span style="font-size:20px;font-weight:800">${fmt(me.plan.balance)} ₽</span>
      </div>
      <div class="note" style="margin-top:10px">
        Платежей в приложении нет — пополнять и подписываться не нужно.
      </div>
    </div>

    ${communityCard()}

    <div class="card" style="margin:12px 16px 0;overflow:hidden">
      <button class="row" data-tab="privacy" style="width:100%;text-align:left">
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-cyan)">${sv('lock',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Конфиденциальность</span>
        <span class="row-sub">Что хранится и как удалить данные</span></span>
        ${sv('arrow',13,'var(--txt-lo)')}
      </button>
    </div>

    <div class="note" style="margin:18px 16px 0;text-align:center">BestSave · бесплатная версия</div>`;
}

// Удаление всех данных. Спрашиваем подтверждение и показываем, что именно
// удалилось, — чтобы результат был виден, а не «готово».
async function eraseAll() {
  const ok = await new Promise((resolve) => {
    if (tg?.showPopup) {
      tg.showPopup({
        title: 'Удалить все данные?',
        message: 'Архив, привязки чатов и настройки будут стёрты без возможности восстановления.',
        buttons: [
          { id: 'yes', type: 'destructive', text: 'Удалить' },
          { id: 'no', type: 'cancel' },
        ],
      }, (id) => resolve(id === 'yes'));
    } else {
      resolve(window.confirm('Удалить все данные? Восстановить будет нельзя.'));
    }
  });
  if (!ok) return;

  try {
    const r = await apiPost('/api/erase', { confirm: 'УДАЛИТЬ' });
    const msg = `Удалено: ${fmt(r.messages)} сообщений, ${fmt(r.chats)} чатов.`;
    if (tg?.showAlert) tg.showAlert(msg); else alert(msg);
    // Состояние обнуляем и перезагружаем: архив теперь пуст
    S.stats = null; S.chats = []; S.me = null; S.events = null; S.settings = null;
    S.tab = 'home';
    await loadAll();
  } catch (e) {
    const msg = 'Не удалось удалить: ' + e.message;
    if (tg?.showAlert) tg.showAlert(msg); else alert(msg);
  }
}

/* ── Админка (только для владельца) ── */
// Показывает эксплуатационные метрики. Содержимого переписки здесь нет
// намеренно — см. комментарий в lib/handlers/admin.js.
async function loadAdmin() {
  if (S.admin) return;
  try { S.admin = await api('/api/admin'); }
  catch (e) { S.admin = { error: e.message }; }
  render();
}

const fmtBytes = (n) => {
  if (!n) return '0 Б';
  const u = ['Б','КБ','МБ','ГБ'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
};

function Admin() {
  const a = S.admin;
  if (!a) { loadAdmin(); return spinner(); }
  if (a.error) return errBox(a.error);

  const u = a.users || {}, m = a.messages || {}, st = a.settings || {};
  const card = (grad, icon, label, value, sub) => `
    <div class="stat" data-stagger>
      <div class="head"><span class="chip" style="width:24px;height:24px;background:${grad}">${sv(icon,12,'#fff',2.4)}</span>${label}</div>
      <div class="num">${value}</div>
      ${sub ? `<div style="font-size:11.5px;color:var(--txt-lo);margin-top:6px;font-weight:600">${sub}</div>` : ''}
    </div>`;

  // Оценка заполнения бесплатного тарифа Postgres (обычно 256 МБ у Neon free,
  // 512 МБ у Supabase). Порог берём консервативно — 256 МБ.
  const LIMIT = 256 * 1024 * 1024;
  const pct = Math.min(100, Math.round((a.storage.dbBytes / LIMIT) * 100));

  const growthVals = a.growth.map((g) => g.n);
  const volumeVals = a.volume.map((v) => v.n);

  return `
    <div class="sec">Пользователи</div>
    <div class="grid2">
      ${card('var(--g-purple)','user','Всего', fmt(u.total), `+${fmt(u.today)} за сутки`)}
      ${card('var(--g-green)','bolt','Активны за неделю', fmt(a.activeWeek), 'приходили сообщения')}
      ${card('var(--g-cyan)','clock','За 7 дней', fmt(u.week), 'новых')}
      ${card('var(--g-orange)','clock','За 30 дней', fmt(u.month), 'новых')}
    </div>

    ${growthVals.length ? barChart(growthVals,
      a.growth.map((g,i) => i % 5 === 0 ? new Date(g.day).getDate() : ''),
      'Регистрации за 30 дней',
      `Всего за период: ${fmt(growthVals.reduce((x,y)=>x+y,0))}`) : ''}

    <div class="sec">Архив</div>
    <div class="grid2">
      ${card('var(--g-purple)','doc','Сообщений', fmt(m.total), `+${fmt(m.today)} за сутки`)}
      ${card('var(--g-pink)','trash','Удалённых', fmt(m.deleted), 'спасено ботом')}
      ${card('var(--g-cyan)','image','С медиа', fmt(m.media), '')}
      ${card('var(--g-orange)','pencil','Изменённых', fmt(m.edited), '')}
    </div>

    ${volumeVals.length ? barChart(volumeVals,
      a.volume.map((v,i) => i % 3 === 0 ? new Date(v.day).getDate() : ''),
      'Поток сообщений за 14 дней',
      `Пик: ${fmt(Math.max(...volumeVals))} в день`) : ''}

    <div class="sec">Подключения</div>
    <div class="card" style="margin:0 16px;overflow:hidden" data-stagger>
      <div class="row">
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-cyan)">${sv('tg',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Telegram Business</span>
        <span class="row-sub">${fmt(a.connections.enabled)} активных из ${fmt(a.connections.total)}</span></span>
      </div>
      ${a.chats.map((c) => `<div class="div"></div>
        <div class="row">
          <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-purple)">${sv('chat',15,'#fff',2.3)}</span>
          <span class="row-main"><span class="row-title">${c.type === 'private' ? 'Личные чаты' : c.type === 'channel' ? 'Каналы' : 'Группы'}</span>
          <span class="row-sub">подключено: ${fmt(c.n)}</span></span>
        </div>`).join('')}
    </div>

    <div class="sec">Хранилище</div>
    <div class="card" style="margin:0 16px;padding:18px" data-stagger>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:15px;font-weight:800;font-family:'Nunito'">${fmtBytes(a.storage.dbBytes)}</span>
        <span style="font-size:12px;color:${pct > 80 ? 'var(--red)' : 'var(--txt-lo)'};font-weight:700">${pct}% от 256 МБ</span>
      </div>
      <div style="height:10px;border-radius:99px;background:var(--glass-hi);overflow:hidden">
        <div style="height:100%;width:${pct}%;border-radius:99px;
          background:${pct > 80 ? 'var(--g-pink)' : pct > 50 ? 'var(--g-orange)' : 'var(--g-green)'};
          transition:width .6s var(--spring)"></div>
      </div>
      <div class="note" style="margin-top:12px">
        Таблица сообщений: ${fmtBytes(a.storage.messagesBytes)}, из них текст — ${fmtBytes(a.storage.textBytes)}.
        Порог 256 МБ взят по нижней границе бесплатных тарифов Postgres —
        сверьтесь со своим провайдером.
      </div>
    </div>

    <div class="sec">Использование настроек</div>
    <div class="card" style="margin:0 16px;padding:18px" data-stagger>
      <div class="note" style="line-height:2">
        Уведомления об удалении: <b style="color:var(--txt)">${fmt(st.notify_deleted)}</b><br>
        Об изменении: <b style="color:var(--txt)">${fmt(st.notify_edited)}</b><br>
        Фейк-контроль: <b style="color:var(--txt)">${fmt(st.notify_fake)}</b><br>
        Тихие часы: <b style="color:var(--txt)">${fmt(st.quiet_hours)}</b>
      </div>
    </div>

    ${m.quarantined ? `
      <div class="card" style="margin:12px 16px 0;padding:17px;border-color:rgba(251,146,60,.4)" data-stagger>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
          ${sv('alert',16,'var(--orange)')}
          <span style="font-size:14px;font-weight:800;font-family:'Nunito';color:var(--orange-2)">Спорные копии: ${fmt(m.quarantined)}</span>
        </div>
        <div class="note">
          Сообщения из чатов, подключённых несколькими пользователями до
          разделения архивов. Владельца установить нельзя, поэтому они скрыты
          у всех. Данные не удалены.
        </div>
      </div>` : ''}

    <div class="note" style="margin:18px 16px 0;text-align:center">
      Обновлено ${new Date(a.generatedAt).toLocaleString('ru-RU')}<br>
      Содержимое переписки пользователей здесь не отображается.
    </div>`;
}

/* ── Конфиденциальность ── */
// Текст описывает то, что приложение делает на самом деле: перечень полей
// совпадает со схемой базы. Обещаний, которых код не выполняет, здесь нет.
function Privacy() {
  const block = (icon, grad, title, body) => `
    <div class="card" style="margin:0 16px 10px;padding:17px" data-stagger>
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:11px">
        <span class="chip" style="width:34px;height:34px;border-radius:12px;background:${grad}">${sv(icon,16,'#fff',2.3)}</span>
        <span style="font-size:15px;font-weight:800;font-family:'Nunito'">${title}</span>
      </div>
      <div class="note">${body}</div>
    </div>`;

  return `
    <div class="sec">Что хранится</div>
    ${block('doc','var(--g-purple)','Сообщения из подключённых чатов', `
      Текст, имя и ID отправителя, время отправки, отметки об удалении и
      правке, а для отредактированных — прежняя версия текста.
      Только те сообщения, что пришли <b style="color:var(--txt)">после</b> подключения:
      выгружать прошлую переписку Telegram ботам не даёт.`)}

    ${block('image','var(--g-cyan)','Файлы — ссылками, не копиями', `
      Фото, голосовые и видео на сервере BestSave
      <b style="color:var(--txt)">не хранятся</b>. Сохраняется только выданный
      Telegram идентификатор файла: по нему приложение подгружает вложение
      из Telegram в момент просмотра. Сами файлы остаются на серверах Telegram.`)}

    ${block('user','var(--g-green)','Профиль', `
      Ваш Telegram ID, имя и username, признак Premium, настройки уведомлений
      и часовой пояс — он нужен, чтобы тихие часы работали по местному времени.
      Аватар не хранится: он запрашивается у Telegram при открытии экрана.`)}

    <div class="sec">Кто это видит</div>
    ${block('lock','var(--g-pink)','Только вы', `
      Архив личных чатов привязан к владельцу. Если ваш собеседник тоже
      пользуется BestSave и переписывается с тем же человеком, вы
      <b style="color:var(--txt)">не увидите</b> его переписку, а он — вашу.
      Данные не продаются, не передаются третьим лицам, рекламы и внешней
      аналитики в приложении нет.`)}

    ${block('alert','var(--g-orange)','О чём стоит помнить', `
      В архив попадают сообщения вашего собеседника, и Telegram его об этом
      не уведомляет. Ответственность за то, как вы используете сохранённую
      переписку, лежит на вас. В некоторых странах запись и хранение личной
      переписки без согласия второй стороны ограничены законом — проверьте
      правила вашей юрисдикции.`)}

    <div class="sec">Где и сколько</div>
    ${block('shield','var(--g-purple)','Хранение', `
      Данные лежат в базе PostgreSQL, приложение работает на Vercel.
      Срок хранения не ограничен: архив существует, пока вы его не удалите.
      Отключение бота в Telegram Business останавливает запись новых
      сообщений, но уже сохранённое остаётся, пока вы не удалите его сами.`)}

    <div class="sec">Удаление</div>
    <div class="card" style="margin:0 16px;padding:17px" data-stagger>
      <div class="note" style="margin-bottom:14px">
        Удаляются: весь ваш личный архив, привязки чатов, бизнес-подключения
        и учётная запись с настройками. Действие необратимо — выгрузите нужные
        чаты заранее кнопкой «Скачать чат».
      </div>
      <button class="btn-danger" data-erase>${sv('trash',16,'#fff',2.4)} Удалить все мои данные</button>
    </div>

    ${communityCard()}

    <div class="note" style="margin:18px 16px 0;text-align:center">
      Вопросы о данных — в поддержку @Business_Senior
    </div>`;
}

/* ── Настройки ── */
function Settings() {
  if (!S.settings) { loadSettings(); return spinner(); }
  const s = S.settings;
  const row = (key, title, sub, on) => `
    <button class="row" data-toggle="${key}" style="width:100%;text-align:left">
      <span class="row-main">
        <span class="row-title">${title}</span>
        <span class="row-sub">${sub}</span>
      </span>
      <span class="toggle ${on ? 'on' : ''}"></span>
    </button>`;

  return `
    <div class="sec">Уведомления от бота</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      ${row('notifyDeleted','Удаление сообщений','Бот напишет в личку, когда в подключённом чате удалят сообщение', s.notifyDeleted)}
      <div class="div"></div>
      ${row('notifyEdited','Изменение сообщений','Сообщение в личку при редактировании — версия «до» уже в архиве', s.notifyEdited)}
      <div class="div"></div>
      ${row('notifyFake','Фейк-контроль медиа','Предупредить, если фото или кружок уже приходили раньше — то есть запись не новая', s.notifyFake)}
    </div>
    <div class="note" style="margin:10px 16px 0">
      Работает для личных чатов, подключённых через Telegram Business —
      только там Telegram присылает событие удаления в момент удаления.
    </div>

    <div class="sec">Не беспокоить</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      ${row('quietHours','Тихие часы',
        `Ночью бот молчит: с ${String(s.quietFrom).padStart(2,'0')}:00 до ${String(s.quietTo).padStart(2,'0')}:00`,
        s.quietHours)}
    </div>
    <div class="note" style="margin:10px 16px 0">
      Время считается по вашему часовому поясу${quietTzLabel()}.
      События всё равно сохраняются в архив — утром увидите их в приложении,
      просто без ночных сообщений.
    </div>

    <div class="sec">Данные</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      <button class="row" data-reload style="width:100%;text-align:left">
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-green)">${sv('refresh',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Обновить архив</span>
        <span class="row-sub">Перечитать чаты и статистику с сервера</span></span>
      </button>
      <div class="div"></div>
      <button class="row" data-tab="profile" style="width:100%;text-align:left">
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-purple)">${sv('user',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Профиль и подключение</span>
        <span class="row-sub">Аватар, архив, Telegram Business</span></span>
        ${sv('arrow',13,'var(--txt-lo)')}
      </button>
      <div class="div"></div>
      <button class="row" data-tab="privacy" style="width:100%;text-align:left">
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-cyan)">${sv('lock',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Конфиденциальность</span>
        <span class="row-sub">Что хранится, где и как это удалить</span></span>
        ${sv('arrow',13,'var(--txt-lo)')}
      </button>
    </div>

    ${S.isAdmin ? `
    <div class="sec">Владелец</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      <button class="row" data-tab="admin" style="width:100%;text-align:left">
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-hero)">${sv('bolt',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Панель владельца</span>
        <span class="row-sub">Метрики продукта, нагрузка, хранилище</span></span>
        ${sv('arrow',13,'var(--txt-lo)')}
      </button>
    </div>` : ''}

    ${communityCard()}

    ${s.offline ? `<div class="note" style="margin:12px 16px 0;color:var(--red)">Настройки сейчас не сохраняются на сервере — нет связи. Изменения применятся при восстановлении.</div>` : ''}`;
}

// Подпись пояса: показываем реальное смещение устройства, чтобы «тихие часы»
// не выглядели абстракцией.
function quietTzLabel() {
  const off = -new Date().getTimezoneOffset(); // минуты к востоку от UTC
  const sign = off >= 0 ? '+' : '−';
  const h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  return ` (UTC${sign}${h}${m ? ':' + String(m).padStart(2,'0') : ''})`;
}

// Ссылки на сообщество — одинаковые на нескольких экранах.
function communityCard() {
  return `
    <div class="sec">Сообщество</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      <a class="row" href="https://t.me/bestsavee" target="_blank" rel="noopener" data-tglink>
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-cyan)">${sv('tg',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Канал BestSave</span>
        <span class="row-sub">Обновления, новые функции, планы</span></span>
        ${sv('arrow',13,'var(--txt-lo)')}
      </a>
      <div class="div"></div>
      <a class="row" href="https://t.me/Business_Senior" target="_blank" rel="noopener" data-tglink>
        <span class="chip" style="width:32px;height:32px;border-radius:11px;background:var(--g-orange)">${sv('chat',15,'#fff',2.3)}</span>
        <span class="row-main"><span class="row-title">Поддержка</span>
        <span class="row-sub">@Business_Senior — вопросы и проблемы</span></span>
        ${sv('arrow',13,'var(--txt-lo)')}
      </a>
    </div>`;
}

/* ── Уведомления ── */
function Notifications() {
  const acts = S.stats?.activity || [];
  if (!acts.length) {
    return `<div class="empty">Пока тихо.<br>Здесь появятся события архива:
      удалённые и изменённые сообщения из ваших чатов.</div>`;
  }
  return `
    <div class="sec">Последние события</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      ${acts.map((a,i) => `${i?'<div class="div"></div>':''}
        <div class="row">
          <span class="chip" style="width:32px;height:32px;border-radius:10px;background:${a.tone==='red'?'rgba(255,77,77,.12)':'rgba(168,85,247,.12)'}">
            ${sv(a.tone==='red'?'trash':'pencil',14,`var(--${a.tone})`)}</span>
          <span class="row-main">
            <span class="row-title">${esc(a.who)}</span>
            <span class="row-sub">${a.what}${a.chat ? ' · ' + esc(a.chat) : ''}</span>
          </span>
          <span style="font-size:10.5px;color:var(--txt-lo);font-variant-numeric:tabular-nums">${timeAgo(a.at)}</span>
        </div>`).join('')}
    </div>
    <div class="note" style="margin:12px 16px 0">
      Чтобы бот присылал такие события в личку — включите их в
      <button data-tab="settings" style="color:var(--green);font-weight:700;padding:0">настройках</button>.
    </div>`;
}

/* ── навигация ── */
function nav() {
  const items = [['home','Главная','home'],['chats','Чаты','chat'],['events','События','bolt'],['ai','AI','ai'],['profile','Профиль','user']];
  const cur = S.tab === 'chatview' ? 'chats' : S.tab;
  return items.map(([k,l,ic]) => `<button class="tab ${cur===k?'on':''}" data-tab="${k}">
    ${sv(ic,19,'currentColor',cur===k?2.3:1.9)}<span>${l}</span></button>`).join('');
}

/* ── рендер ── */
let prevScreen = null;
function render() {
  $('top').innerHTML = topBar();
  $('nav').innerHTML = nav();
  const main = $('main');
  if (S.loading) { main.innerHTML = spinner(); return; }
  if (S.error && !S.stats) { main.innerHTML = errBox(S.error); return; }
  const screens = { home:Home, chats:Chats, chatview:ChatView, events:Events, ai:AI,
    profile:Profile, settings:Settings, notifications:Notifications, privacy:Privacy,
    admin:Admin };
  main.innerHTML = (screens[S.tab] || Home)();

  // Визуальный слой: живые счётчики + каскад карточек после отрисовки.
  runEntrance(main);
  prevScreen = S.tab;
}

/* ── события ── */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab],[data-open],[data-ctab],[data-reload],[data-addbot],[data-export],[data-toggle],[data-clear-search],[data-erase],[data-tglink],[data-pin],[data-clear-msgsearch]');
  if (!el) return;
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

  if (el.dataset.addbot !== undefined && tg?.openTelegramLink) {
    e.preventDefault(); tg.openTelegramLink(el.getAttribute('href')); return;
  }
  // Ссылки на канал и поддержку открываем внутри Telegram, а не в браузере
  if (el.dataset.tglink !== undefined) {
    const href = el.getAttribute('href');
    if (tg?.openTelegramLink) { e.preventDefault(); tg.openTelegramLink(href); }
    return;
  }
  if (el.dataset.erase !== undefined) { eraseAll(); return; }
  if (el.dataset.pin) { togglePin(Number(el.dataset.pin)); return; }
  if (el.dataset.clearMsgsearch !== undefined) { S.msgSearch = ''; loadMessages(); return; }
  if (el.dataset.export) { downloadChat(el.dataset.export); return; }
  if (el.dataset.toggle) { toggleSetting(el.dataset.toggle); return; }
  if (el.dataset.clearSearch !== undefined) { S.chatSearch = ''; render(); return; }
  if (el.dataset.reload !== undefined) { S.events = null; S.settings = null; S.admin = null; loadAll(); return; }
  if (el.dataset.open) { openChat(el.dataset.open); return; }
  if (el.dataset.ctab) {
    S.chatTab = el.dataset.ctab;
    if (S.chatTab === 'activity') { loadActivity(); } else { loadMessages(); }
    return;
  }
  if (el.dataset.tab) {
    const to = el.dataset.tab;
    // Запоминаем, откуда пришли в настройки/уведомления — туда и вернёмся
    const overlay = ['settings','notifications','privacy','admin'];
    if (overlay.includes(to) && !overlay.includes(S.tab)) {
      S.prevTab = S.tab === 'chatview' ? 'chats' : S.tab;
    }
    S.tab = to;
    if (S.tab === 'events') S.events = null;
    render();
    window.scrollTo({ top: 0 });
    if (S.tab === 'events') loadEvents();
    if (S.tab === 'settings') loadSettings();
    if (S.tab === 'admin') { S.admin = null; loadAdmin(); }
  }
});

// Отложенный запуск серверного поиска по сообщениям
let msgSearchTimer = null;

// Поиск по чатам: фильтруем на месте, не теряя фокус и позицию курсора
document.addEventListener('input', (e) => {
  if (e.target.id === 'chat-search') {
    S.chatSearch = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.getElementById('chat-search');
    if (input) { input.focus(); try { input.setSelectionRange(pos, pos); } catch {} }
    return;
  }

  // Поиск по сообщениям идёт на сервер, поэтому запрос откладываем:
  // без задержки каждый символ порождал бы обращение к базе.
  if (e.target.id === 'msg-search') {
    S.msgSearch = e.target.value;
    clearTimeout(msgSearchTimer);
    msgSearchTimer = setTimeout(() => {
      loadMessages().then(() => {
        // Возвращаем фокус: render() пересобирает разметку
        const input = document.getElementById('msg-search');
        if (input && document.activeElement !== input) {
          input.focus();
          const v = input.value;
          try { input.setSelectionRange(v.length, v.length); } catch {}
        }
      });
    }, 350);
  }
});

/* ── старт ── */
if (tg) { tg.ready(); tg.expand(); }
if (!initData) {
  $('main').innerHTML = `<div class="err">Откройте приложение внутри Telegram — вне его нет данных авторизации.</div>`;
  $('nav').style.display = 'none';
} else {
  loadBot().then(render);
  loadAll();
}
