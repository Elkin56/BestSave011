// scripts/check-self-destruct.js
// Проверка обнаружения самоуничтожающихся медиа

import { 
  isSelfDestructing, 
  getTTL, 
  getMediaFileId,
  getMediaType,
  getMediaUniqueId 
} from '../lib/self-destruct.js';

console.log('🧪 ТЕСТИРОВАНИЕ ОБНАРУЖЕНИЯ САМОУНИЧТОЖАЮЩИХСЯ МЕДИА\n');
console.log('=' .repeat(60));

// Тестовые сообщения
const tests = [
  {
    name: 'Фото с TTL',
    message: {
      photo: [{ file_id: 'photo1', file_unique_id: 'u1', ttl_seconds: 10 }]
    }
  },
  {
    name: 'Кружок с TTL',
    message: {
      video_note: { file_id: 'vn1', file_unique_id: 'u2', ttl_seconds: 5, duration: 6, length: 240 }
    }
  },
  {
    name: 'Видео с TTL',
    message: {
      video: { file_id: 'video1', file_unique_id: 'u3', ttl_seconds: 15, duration: 30 }
    }
  },
  {
    name: 'Голосовое с TTL',
    message: {
      voice: { file_id: 'voice1', file_unique_id: 'u4', ttl_seconds: 8, duration: 30 }
    }
  },
  {
    name: 'Обычное фото (без TTL)',
    message: {
      photo: [{ file_id: 'photo2', file_unique_id: 'u5' }]
    }
  }
];

let found = 0;
let total = 0;

for (const test of tests) {
  total++;
  const msg = test.message;
  const isDestruct = isSelfDestructing(msg);
  const ttl = getTTL(msg);
  const type = getMediaType(msg);
  const fileId = getMediaFileId(msg);
  const uniqueId = getMediaUniqueId(msg);
  
  console.log(`\n📌 ${test.name}`);
  console.log(`   Тип: ${type || 'не определен'}`);
  console.log(`   Самоуничтожающееся: ${isDestruct ? '✅ ДА' : '❌ НЕТ'}`);
  if (ttl) console.log(`   TTL: ${ttl} секунд`);
  console.log(`   File ID: ${fileId ? '✅ ЕСТЬ' : '❌ НЕТ'}`);
  console.log(`   Unique ID: ${uniqueId ? '✅ ЕСТЬ' : '❌ НЕТ'}`);
  
  if (isDestruct) found++;
}

console.log('\n' + '=' .repeat(60));
console.log(`\n📊 Результат: ${found} из ${total} сообщений определены как самоуничтожающиеся`);
console.log(`✅ ${found === 4 ? 'Все тесты пройдены!' : 'Некоторые тесты не прошли'}`);