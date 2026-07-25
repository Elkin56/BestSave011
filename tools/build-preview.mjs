#!/usr/bin/env node
// tools/build-preview.mjs
// Собирает автономный HTML для просмотра визуала в обычном браузере.
//
// Берёт НАСТОЯЩИЕ index.html и app.js, поэтому превью не расходится с кодом:
// подменяются только сеть (api/apiPost → мок-данные) и Telegram SDK.
// Логика рендера, разметка и стили — те же самые.

import { readFileSync, writeFileSync } from 'node:fs';
import { todaysEvents } from '../lib/analytics.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'preview.html');

const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
let app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const catB64 = readFileSync(join(ROOT, 'public/cat.jpg')).toString('base64');
const CAT = `data:image/jpeg;base64,${catB64}`;

// Карточки «Событий» собирает серверный модуль аналитики. Чтобы превью
// показывало их настоящую вёрстку, а не выдуманную, прогоняем реальный
// генератор здесь и вкладываем готовый результат.
const EVENT_CARDS = todaysEvents({
  busiestDay: { day: '2026-06-14', count: 96 },
  avgPerDay: 34.2,
  streak: 12,
  deletedTotal: 28,
  firsts: [{
    title: 'Artem',
    firstDate: '2026-03-11T12:04:00Z',
    firstText: 'Привет! Это тот самый чат, с которого всё началось.',
    firstPhoto: '2026-03-12T09:20:00Z',
    firstVoice: '2026-03-14T18:41:00Z',
  }],
  peaks: [{ title: 'Команда BestSave', month: '2026-06', count: 412 }],
  totals: [{ title: 'ageeva_a', count: 87, days: 41 }],
  latestNight: { at: '2026-05-02T02:47:00Z', title: 'Artem' },
}, 4);

// ── 1. Отрезаем боевой старт: в превью данные приходят из мока ──
app = app.slice(0, app.indexOf('/* ── старт ── */'));

// ── 2. Telegram SDK отсутствует, но initData должен быть непустым,
//       иначе приложение покажет заглушку «откройте в Telegram» ──
app = app.replace("const tg = window.Telegram?.WebApp;", "const tg = null; // превью: вне Telegram");
app = app.replace("const initData = tg?.initData || '';", "const initData = 'preview';");

// ── 3. Картинка талисмана — из файла, а не по сетевому пути ──
app = app.replaceAll('"/cat.jpg"', JSON.stringify(CAT));
app = app.replaceAll("'/cat.jpg'", JSON.stringify(CAT));

// ── 4. Сеть → мок. Сигнатуры сохранены, чтобы вызывающий код не менялся ──
app = app.replace(
  /async function api\(path\) \{[\s\S]*?\n\}/,
  `async function api(path) { return MOCK.get(path); }`
);
app = app.replace(
  /async function apiPost\(path, body\) \{[\s\S]*?\n\}/,
  `async function apiPost(path, body) { return MOCK.post(path, body); }`
);

// Аватары в превью не подгрузить (нет Telegram) — вместо сетевого адреса
// подставляем сгенерированные заглушки: часть чатов «с фото», часть без,
// чтобы видеть оба состояния.
app = app.replace(
  /const authUrl = \(path, params = \{\}\) => \{[\s\S]*?\n\};/,
  `const authUrl = (path, params = {}) => MOCK.avatar(path, params);`
);

const MOCK = `
const PREVIEW_EVENT_CARDS = ${JSON.stringify(EVENT_CARDS)};

/* ══ Мок-данные превью ══
   Никакой сети: значения подобраны похожими на реальные, чтобы оценить
   вёрстку на живых объёмах — длинные названия, крупные числа, пустые
   состояния. ══ */
const PREVIEW_CHATS = [
  { chatId:'111', title:'Complex_store63', stats:{total:74, deleted:2, edited:2}, viaBusiness:true },
  { chatId:'222', title:'Сания',           stats:{total:19, deleted:1, edited:0}, viaBusiness:true },
  { chatId:'333', title:'Artem',           stats:{total:36, deleted:2, edited:1}, viaBusiness:true },
  { chatId:'444', title:'LC',              stats:{total:12, deleted:2, edited:0}, viaBusiness:true },
  { chatId:'555', title:'GPTron | Nano Banana 2 | Разработка',
                                           stats:{total:1,  deleted:0, edited:0}, viaBusiness:true },
  { chatId:'666', title:'ageeva_a',        stats:{total:87, deleted:3, edited:0}, viaBusiness:true },
  { chatId:'777', title:'Команда BestSave',stats:{total:1240,deleted:18,edited:7}, viaBusiness:false },
];

const PREVIEW_MSGS = [
  { id:1, senderName:'Артём', senderId:'901', text:'Слушай, я насчёт вчерашнего — давай перенесём на пятницу?',
    isDeleted:true, isEdited:false, isPinned:true, mediaType:null, hasMedia:false,
    sentAt:'2026-07-22T19:41:00Z' },
  { id:2, senderName:'Артём', senderId:'901', text:null, mediaType:'photo', hasMedia:true,
    isDeleted:true, isEdited:false, isPinned:false, sentAt:'2026-07-22T19:44:00Z',
    repeatOfAt:'2026-05-14T10:02:00Z' },
  { id:3, senderName:'Вы', senderId:'900', text:'Ок, договорились. Скину детали ближе к делу.',
    isDeleted:false, isEdited:true, isPinned:false, mediaType:null, hasMedia:false,
    sentAt:'2026-07-22T19:47:00Z' },
  { id:4, senderName:'Артём', senderId:'901', text:null, mediaType:'voice', hasMedia:true,
    isDeleted:true, isEdited:false, isPinned:false, sentAt:'2026-07-22T20:03:00Z' },
  { id:5, senderName:'Артём', senderId:'901', text:'Всё, я на месте. Жду внизу у входа.',
    isDeleted:true, isEdited:false, isPinned:false, mediaType:null, hasMedia:false,
    sentAt:'2026-07-23T08:15:00Z' },
];

const MOCK = {
  async get(path) {
    await new Promise((r) => setTimeout(r, 120)); // лёгкая задержка: видно спиннеры
    const [route, qs] = path.replace('/api/', '').split('?');
    const p = new URLSearchParams(qs || '');

    if (route === 'bot-info') return { username:'TheMurconBot' };

    if (route === 'stats') return {
      totals:{ total:1469, deleted:28, edited:10, media:212, voices:34 },
      chats: PREVIEW_CHATS.length,
      since:'2026-03-11T00:00:00Z',
      activity:[
        { who:'Артём', chat:'Artem', what:'Удалено сообщение', tone:'red',    at:'2026-07-23T08:15:00Z' },
        { who:'Сания', chat:'Сания', what:'Удалено сообщение', tone:'red',    at:'2026-07-22T21:30:00Z' },
        { who:'Вы',    chat:'Artem', what:'Изменено сообщение', tone:'violet', at:'2026-07-22T19:47:00Z' },
      ],
    };

    if (route === 'chats') return { chats: PREVIEW_CHATS, businessConnected:true };

    if (route === 'messages') {
      const filter = p.get('filter') || 'all';
      const qq = (p.get('q') || '').toLowerCase();
      let list = PREVIEW_MSGS.slice();
      if (filter === 'deleted') list = list.filter((m) => m.isDeleted);
      if (filter === 'edited')  list = list.filter((m) => m.isEdited);
      if (filter === 'pinned')  list = list.filter((m) => m.isPinned);
      if (filter === 'media')   list = list.filter((m) => m.mediaType === 'photo');
      if (filter === 'voices')  list = list.filter((m) => ['voice','video_note'].includes(m.mediaType));
      if (qq) list = list.filter((m) => (m.text || '').toLowerCase().includes(qq));
      return { messages:list, nextBefore:null };
    }

    if (route === 'activity') return {
      total:1469,
      hours:[12,4,2,1,0,0,1,6,28,44,51,60,72,68,55,49,58,66,74,81,77,64,40,22],
      weekdays:[210,188,240,205,268,190,168],
      daily: Array.from({length:30}, (_,i) => ({
        day:new Date(Date.now() - (29-i)*86400000).toISOString().slice(0,10),
        count: Math.round(30 + 25*Math.sin(i/3) + (i%7===5?18:0)),
      })),
      windowDays:30,
    };

    if (route === 'gate') return PREVIEW_GATE();

    if (route === 'events') return { cards: PREVIEW_EVENT_CARDS, totalMessages: 1469 };

    if (route === 'me') return {
      user:{ firstName:'Матео', username:'mateo', isPremium:true, photoUrl:'' },
      archive:{ chats:PREVIEW_CHATS.length, messages:1469, deleted:28, since:'2026-03-11T00:00:00Z' },
      business:{ connected:true },
      plan:{ name:'Free', balance:0 },
      resourceToken:'preview',
      isAdmin:true,
    };

    if (route === 'settings') return {
      notifyDeleted:true, notifyEdited:false, notifyFake:true,
      quietHours:true, quietFrom:23, quietTo:8, tzOffsetMin:240,
    };

    if (route === 'admin') return {
      users:{ total:1240, today:18, week:96, month:410 },
      activeWeek:305,
      growth: Array.from({length:30}, (_,i) => ({
        day:new Date(Date.now() - (29-i)*86400000).toISOString().slice(0,10),
        count:0, n: Math.round(8 + 6*Math.sin(i/4)),
      })),
      chats:[{ type:'private', n:820 }, { type:'group', n:41 }],
      messages:{ total:98213, today:1450, deleted:3120, edited:880, media:12400, quarantined:37 },
      volume: Array.from({length:14}, (_,i) => ({
        day:new Date(Date.now() - (13-i)*86400000).toISOString().slice(0,10),
        n: Math.round(1100 + 300*Math.sin(i/2)),
      })),
      connections:{ total:840, enabled:812 },
      storage:{ dbBytes:198*1024*1024, messagesBytes:150*1024*1024, textBytes:40*1024*1024 },
      settings:{ notify_deleted:1100, notify_edited:210, notify_fake:980, quiet_hours:430 },
      list:[
        { id:'901', name:'Георгий', username:'georgy', premium:true,  since:'2026-03-11T00:00:00Z', chats:4, messages:2066, lastActive:new Date().toISOString(), business:true },
        { id:'902', name:'Сания',   username:'saniya', premium:false, since:'2026-04-02T00:00:00Z', chats:2, messages:512,  lastActive:new Date().toISOString(), business:true },
        { id:'903', name:'Артём',   username:null,     premium:false, since:'2026-04-18T00:00:00Z', chats:3, messages:889,  lastActive:'2026-05-20T00:00:00Z', business:true },
        { id:'904', name:'ageeva_a',username:'ageeva', premium:false, since:'2026-05-30T00:00:00Z', chats:1, messages:87,   lastActive:new Date().toISOString(), business:false },
        { id:'905', name:null,      username:'lc_dev', premium:true,  since:'2026-06-12T00:00:00Z', chats:2, messages:143,  lastActive:'2026-06-15T00:00:00Z', business:true },
      ],
      generatedAt:new Date().toISOString(),
    };

    throw new Error('в превью нет данных для ' + route);
  },

  async post(path, body) {
    await new Promise((r) => setTimeout(r, 80));
    if (path.includes('settings')) return { ...body };
    if (path.includes('pin')) return { pinned: body.pinned !== false };
    if (path.includes('erase')) return { ok:true, messages:1469, chats:7, connections:1 };
    return { ok:true };
  },

  // Аватары: настоящие фото Telegram в браузере недоступны, поэтому часть
  // чатов получает сгенерированную заглушку «как будто фото», а часть —
  // ничего, чтобы была видна и цветная буква.
  avatar(path, params) {
    if (!path.includes('/api/avatar')) return path + '?preview';
    const key = String(params.chat ?? params.peer ?? 'self');
    const WITH_PHOTO = ['111','333','666','901','self'];
    if (!WITH_PHOTO.includes(key)) return 'about:blank'; // сработает onerror → буква
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const a = h % 360, b = (h >> 3) % 360;
    const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(\${a},70%,62%)"/>
        <stop offset="1" stop-color="hsl(\${b},68%,40%)"/></linearGradient></defs>
      <rect width="120" height="120" fill="url(#g)"/>
      <circle cx="60" cy="46" r="20" fill="rgba(255,255,255,.85)"/>
      <path d="M20 120c0-24 18-38 40-38s40 14 40 38z" fill="rgba(255,255,255,.85)"/>
    </svg>\`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },
};

// Состояние гейта в превью переключается кнопками внизу: 0 — ничего не
// выполнено, 1 — подписка есть и один друг, 2 — доступ открыт.
window.PREVIEW_GATE_STEP = 2;
function PREVIEW_GATE() {
  const step = window.PREVIEW_GATE_STEP;
  const link = 'https://t.me/bestsaves_bot?start=ref901';
  return {
    passed: step === 2,
    channel: {
      title: 'BestSave Community',
      url: 'https://t.me/bestsavee',
      subscribed: step >= 1,
    },
    invites: {
      count: step === 0 ? 0 : step === 1 ? 1 : 3,
      need: 3,
      left: step === 0 ? 3 : step === 1 ? 2 : 0,
      link,
      shareUrl: 'https://t.me/share/url?url=' + encodeURIComponent(link),
    },
  };
}

// Панель переключения экранов — только в превью, в приложении её нет.
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  bar.innerHTML = '<span>превью:</span>' + [
    ['home','Главная'], ['chats','Чаты'], ['chatview','Внутри чата'],
    ['events','События'], ['ai','AI'], ['profile','Профиль'],
    ['settings','Настройки'], ['privacy','Политика'], ['admin','Админка'],
    ['gate0','Условия 0/3'], ['gate1','Условия 1/3'],
  ].map(([k,l]) => \`<button data-preview="\${k}">\${l}</button>\`).join('');
  document.body.appendChild(bar);

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preview]');
    if (!b) return;
    const to = b.dataset.preview;
    if (to === 'gate0' || to === 'gate1') {
      window.PREVIEW_GATE_STEP = to === 'gate0' ? 0 : 1;
      S.gate = null; S.error = null; loadAll();
      window.scrollTo({ top:0 });
      return;
    }
    if (to === 'chatview') {
      S.chat = PREVIEW_CHATS[2]; S.chatTab = 'deleted'; S.msgSearch = '';
      S.tab = 'chatview'; loadMessages();
    } else {
      S.tab = to; render();
      if (to === 'events') loadEvents();
      if (to === 'settings') loadSettings();
      if (to === 'admin') { S.admin = null; loadAdmin(); }
    }
    window.scrollTo({ top:0 });
  });
});
`;

const BOOT = `
/* ── старт превью ── */
loadBot().then(render);
loadAll();
`;

const PREVIEW_CSS = `
  /* Оформление самой страницы превью (в приложении этого нет) */
  body{background:#07060F;padding-bottom:70px}
  #app{box-shadow:0 0 0 1px rgba(255,255,255,.08),0 30px 90px rgba(0,0,0,.6);
    min-height:100vh}
  .preview-bar{position:fixed;left:0;right:0;bottom:0;z-index:999;display:flex;gap:6px;
    align-items:center;padding:10px 12px;overflow-x:auto;
    background:rgba(8,6,18,.94);border-top:1px solid rgba(255,255,255,.12);
    backdrop-filter:blur(16px);font-family:'Manrope',system-ui,sans-serif}
  .preview-bar span{font-size:11px;color:#6F6A92;flex-shrink:0;font-weight:700;
    text-transform:uppercase;letter-spacing:.5px}
  .preview-bar button{flex-shrink:0;padding:7px 13px;border-radius:9px;font-size:12.5px;
    font-weight:700;color:#CFC8F0;background:rgba(255,255,255,.08);
    border:1px solid rgba(255,255,255,.1);cursor:pointer}
  .preview-bar button:hover{background:rgba(255,255,255,.16)}
  /* Нижняя навигация приложения приподнята, чтобы не спорить с панелью превью */
  nav{bottom:72px !important}
`;

// ── Сборка ──
// Замены делаются функциями, а не строками: в исходнике есть '\\$&'
// (экранирование regex в подсветке поиска), а в строке замены $& означает
// найденный фрагмент — подстановка молча испортила бы код.
let out = html;
out = out.replace('</style>', () => PREVIEW_CSS + '\n</style>');
out = out.replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>', () => '');
out = out.replace('<script src="/app.js"></script>',
  () => '<script>\n' + MOCK + '\n' + app + '\n' + BOOT + '\n</script>');

writeFileSync(OUT, out);
console.log('превью собрано:', OUT, `(${(out.length / 1024).toFixed(0)} КБ)`);
