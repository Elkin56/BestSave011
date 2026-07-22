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
  botUsername: null,
  loading: true,
  error: null,
  stats: null,
  chats: [],
  businessConnected: false,
  chat: null, chatTab: 'deleted', messages: [], chatLoading: false,
  events: null,
  me: null,
  aiTab: 0,
};

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
};
const sv = (n, s, c, w) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="${c}" stroke-width="${w||2}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${I[n]||''}</svg>`;

const COLORS = { gold:'var(--gold)', green:'var(--green)', red:'var(--red)', violet:'var(--violet)', blue:'var(--blue)' };

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
  S.tab = 'chatview'; S.chatTab = 'deleted'; S.messages = []; S.chatLoading = true; render();
  await loadMessages();
}

async function loadMessages() {
  S.chatLoading = true; render();
  try {
    const f = S.chatTab === 'voices' ? 'media' : S.chatTab;
    const d = await api(`/api/messages?chatId=${encodeURIComponent(S.chat.chatId)}&filter=${f}`);
    let list = d.messages || [];
    if (S.chatTab === 'voices') list = list.filter((m) => ['voice','video_note'].includes(m.mediaType));
    if (S.chatTab === 'media') list = list.filter((m) => !['voice','video_note'].includes(m.mediaType));
    S.messages = list;
  } catch (e) { S.error = e.message; }
  finally { S.chatLoading = false; render(); }
}

const addBotLink = () => S.botUsername
  ? `https://t.me/${encodeURIComponent(S.botUsername)}?startgroup=archive` : null;

/* ── общие куски ── */
const spinner = () => `<div class="spinner"><i></i><i></i><i></i></div>`;
const errBox = (m) => `<div class="err">Не удалось загрузить: ${esc(m)}
  <button class="btn-ghost" data-reload style="margin-top:12px">Повторить</button></div>`;

function topBar() {
  const titles = { home:'BestSave', chats:'Чаты', events:'События', ai:'AI Анализ', profile:'Профиль' };
  if (S.tab === 'chatview' && S.chat) {
    return `<button class="icon-btn" data-tab="chats">${sv('back',17,'var(--txt-lo)')}</button>
      <div style="flex:1;min-width:0">
        <div class="brand" style="font-size:15px">${esc(S.chat.title || 'Чат')}</div>
        <div style="font-size:10.5px;color:var(--txt-lo)">${fmt(S.chat.stats.total)} в архиве</div>
      </div>`;
  }
  return `<div class="logo">${sv('shield',17,'#031003',2.2)}</div>
    <div style="flex:1"><div class="brand">${titles[S.tab] || 'BestSave'}</div></div>
    <button class="icon-btn" data-reload>${sv('refresh',16,'var(--txt-lo)')}</button>`;
}

/* ── Главная ── */
function Home() {
  const t = S.stats?.totals || {};
  const stat = (ic, c, label, n) => `<div class="stat">
    <div class="head"><span class="chip" style="background:${c}22">${sv(ic,12,c,2.2)}</span>${label}</div>
    <div class="num" style="color:${c}">${fmt(n)}</div></div>`;

  const empty = !t.total;
  return `
    <div class="hero">
      <div class="hero-glow"></div>
      <img class="cat" src="/cat.jpg" width="520" height="620" decoding="async" alt="BestSave">
      ${S.businessConnected
        ? `<div class="ok-badge" style="margin-top:10px">✅ Личные чаты подключены</div>`
        : `<div class="hero-sub" style="margin-top:10px">Архив ещё не подключён</div>`}
    </div>

    ${empty ? `
      <div class="card" style="margin:14px 16px 0;padding:18px">
        <div style="font-size:15px;font-weight:800;margin-bottom:10px">Архив пока пуст</div>
        <div class="note">
          Сообщения появятся здесь, как только придут <b style="color:var(--txt)">новые</b> —
          Telegram не даёт ботам выгружать прошлую переписку.
        </div>
      </div>` : `
      <div class="grid2" style="margin-top:14px">
        ${stat('trash','var(--red)','Удалено', t.deleted)}
        ${stat('pencil','var(--violet)','Изменено', t.edited)}
        ${stat('image','var(--blue)','Медиа', t.media)}
        ${stat('mic','var(--pink)','Голосовые', t.voices)}
      </div>

      <div class="card" style="margin:12px 16px 0;padding:15px;display:flex;align-items:center;gap:12px">
        <span class="chip" style="width:34px;height:34px;border-radius:11px;background:var(--green-soft);border:1px solid var(--green-line)">
          ${sv('doc',16,'var(--green)')}</span>
        <span style="flex:1">
          <span style="display:block;font-size:12px;color:var(--txt-lo)">Всего в архиве</span>
          <span style="display:block;font-size:22px;font-weight:800;margin-top:2px">${fmt(t.total)}</span>
        </span>
        <span style="font-size:12px;color:var(--txt-lo)">${S.stats.chats} ${S.stats.chats===1?'чат':'чатов'}</span>
      </div>`}

    <div class="sec">Быстрый доступ</div>
    <div class="grid2">
      ${[['chat','Чаты','chats'],['bolt','События','events'],['ai','AI Анализ','ai'],['user','Профиль','profile']]
        .map(([ic,l,go]) => `<button class="card qa" data-tab="${go}">
          <span class="chip" style="width:32px;height:32px;border-radius:10px;background:var(--green-soft);border:1px solid var(--green-line)">${sv(ic,15,'var(--green)')}</span>
          <span style="font-size:13.5px;font-weight:700">${l}</span></button>`).join('')}
    </div>

    ${S.stats?.activity?.length ? `
      <div class="sec">Последняя активность</div>
      <div class="card" style="margin:0 16px;overflow:hidden">
        ${S.stats.activity.map((a,i) => `${i?'<div class="div"></div>':''}
          <div class="row">
            <span class="ava" style="width:36px;height:36px;font-size:13px">${esc((a.who||'?')[0])}</span>
            <span class="row-main">
              <span class="row-title">${esc(a.who)}</span>
              <span style="display:block;font-size:11.5px;color:var(--${a.tone});margin-top:1px">${a.what}</span>
            </span>
            <span style="font-size:10.5px;color:var(--txt-lo)">${timeAgo(a.at)}</span>
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
           <div class="connect-step"><span class="num">1</span> Настройки → Telegram Business → Чат-боты</div>
           <div class="connect-step"><span class="num">2</span> Впишите ${S.botUsername ? '@'+esc(S.botUsername) : 'бота'}</div>
           <div class="note">Нужен Telegram Premium.</div>`}
      <button class="btn-green" data-reload style="margin-top:16px">Обновить</button>
      ${addBotLink() ? `<a class="btn-ghost" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot style="margin-top:8px">Добавить бота в группу</a>` : ''}
    </div>`;
  }

  return `<div class="sec">Подключено · ${S.chats.length}</div>
    <div class="card" style="margin:0 16px;overflow:hidden">
      ${S.chats.map((c,i) => `${i?'<div class="div"></div>':''}
        <button class="row" data-open="${esc(c.chatId)}" style="width:100%;text-align:left">
          <span class="ava">${esc((c.title||'?')[0])}</span>
          <span class="row-main">
            <span class="row-title">${esc(c.title || 'Без названия')}</span>
            <span class="row-sub">${fmt(c.stats.total)} в архиве</span>
          </span>
          <span class="row-side">
            ${c.stats.deleted ? `<span class="tag red">${sv('trash',10,'var(--red)',2.4)}${c.stats.deleted}</span>` : ''}
            ${c.stats.edited ? `<span class="tag violet">${sv('pencil',10,'var(--violet)',2.4)}${c.stats.edited}</span>` : ''}
            ${c.viaBusiness ? '<span class="tag biz">личный</span>' : ''}
            ${sv('arrow',13,'var(--txt-lo)')}
          </span>
        </button>`).join('')}
    </div>
    ${addBotLink() ? `<a class="btn-ghost" href="${addBotLink()}" target="_blank" rel="noopener" data-addbot style="margin:12px 16px 0">+ Подключить группу</a>` : ''}`;
}

/* ── Чат внутри ── */
function ChatView() {
  const tabs = [['deleted','Удалённые'],['media','Медиа'],['voices','Голосовые'],['edited','Изменённые'],['all','Все']];
  const body = () => {
    if (S.chatLoading) return spinner();
    if (!S.messages.length) return `<div class="empty">Здесь пока пусто.</div>`;
    return S.messages.map((m) => `
      <div class="card msg ${m.isDeleted?'del':''}" style="margin:0 16px 8px;padding:13px">
        <div class="msg-head">
          <span class="msg-who">${esc(m.senderName || 'Кто-то')}</span>
          <span style="font-size:10.5px;color:var(--txt-lo)">${new Date(m.sentAt).toLocaleString('ru-RU')}</span>
          ${m.isDeleted?'<span class="tag red" style="margin-left:auto">удалено</span>':''}
          ${m.isEdited && !m.isDeleted?'<span class="tag violet" style="margin-left:auto">изменено</span>':''}
        </div>
        <div class="msg-text">${m.mediaType ? mediaLabel(m.mediaType) : esc(m.text || '—')}</div>
      </div>`).join('');
  };
  return `<div class="filters">
      ${tabs.map(([k,l]) => `<button class="chip-btn ${S.chatTab===k?'on':''}" data-ctab="${k}">${l}</button>`).join('')}
    </div>
    <div style="margin-top:14px">${body()}</div>`;
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
      if (e.kind === 'first') return `<div class="card ev">
        ${head}<div style="font-size:11px;color:var(--txt-lo);margin-bottom:11px">${esc(e.date||'')}</div>
        ${e.lines.map(([l,v],i)=>`<div class="ev-line" style="${i?'border-top:1px solid var(--line)':''}">
          <span style="font-size:11.5px;color:var(--txt-lo);width:120px;flex-shrink:0">${esc(l)}</span>
          <span style="flex:1;font-size:12.5px;font-weight:600;min-width:0">${esc(v)}</span></div>`).join('')}
      </div>`;
      return `<div class="card ev">
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
          ${u.photoUrl
            ? `<img src="${esc(u.photoUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
            : `<div class="ava-letter">${esc(name[0])}</div>`}
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
      <div class="stat"><div class="head">Чатов</div><div class="num">${fmt(a.chats)}</div></div>
      <div class="stat"><div class="head">Сообщений</div><div class="num">${fmt(a.messages)}</div></div>
      <div class="stat"><div class="head">Спасено удалённых</div><div class="num" style="color:var(--red)">${fmt(a.deleted)}</div></div>
      <div class="stat"><div class="head">Архив с</div><div class="num" style="font-size:15px">${a.since?new Date(a.since).toLocaleDateString('ru-RU'):'—'}</div></div>
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

    <div class="note" style="margin:18px 16px 0;text-align:center">BestSave · бесплатная версия</div>`;
}

/* ── навигация ── */
function nav() {
  const items = [['home','Главная','home'],['chats','Чаты','chat'],['events','События','bolt'],['ai','AI','ai'],['profile','Профиль','user']];
  const cur = S.tab === 'chatview' ? 'chats' : S.tab;
  return items.map(([k,l,ic]) => `<button class="tab ${cur===k?'on':''}" data-tab="${k}">
    ${sv(ic,19,'currentColor',cur===k?2.3:1.9)}<span>${l}</span></button>`).join('');
}

/* ── рендер ── */
function render() {
  $('top').innerHTML = topBar();
  $('nav').innerHTML = nav();
  const main = $('main');
  if (S.loading) { main.innerHTML = spinner(); return; }
  if (S.error && !S.stats) { main.innerHTML = errBox(S.error); return; }
  const screens = { home:Home, chats:Chats, chatview:ChatView, events:Events, ai:AI, profile:Profile };
  main.innerHTML = (screens[S.tab] || Home)();
}

/* ── события ── */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab],[data-open],[data-ctab],[data-reload],[data-addbot]');
  if (!el) return;
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

  if (el.dataset.addbot !== undefined && tg?.openTelegramLink) {
    e.preventDefault(); tg.openTelegramLink(el.getAttribute('href')); return;
  }
  if (el.dataset.reload !== undefined) { S.events = null; loadAll(); return; }
  if (el.dataset.open) { openChat(el.dataset.open); return; }
  if (el.dataset.ctab) { S.chatTab = el.dataset.ctab; loadMessages(); return; }
  if (el.dataset.tab) {
    S.tab = el.dataset.tab;
    if (S.tab === 'events') S.events = null;
    render();
    window.scrollTo({ top: 0 });
    if (S.tab === 'events') loadEvents();
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
