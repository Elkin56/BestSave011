// lib/self-destruct.js
// Специальный обработчик для самоуничтожающихся медиа
// (исчезающие фото, видео, кружки)

/**
 * Проверяет, является ли сообщение самоуничтожающимся
 * Telegram использует TTL (time-to-live) в секундах
 */
export function isSelfDestructing(message) {
  if (!message) return false;
  
  // Проверка TTL в разных местах структуры сообщения
  // 1. Фото
  if (message.photo && Array.isArray(message.photo)) {
    for (const photo of message.photo) {
      if (photo.ttl_seconds && photo.ttl_seconds > 0) {
        return true;
      }
    }
  }
  
  // 2. Видео-заметки (кружки)
  if (message.video_note && message.video_note.ttl_seconds > 0) {
    return true;
  }
  
  // 3. Видео
  if (message.video && message.video.ttl_seconds > 0) {
    return true;
  }
  
  // 4. Голосовые
  if (message.voice && message.voice.ttl_seconds > 0) {
    return true;
  }
  
  // 5. Документы с TTL атрибутом
  if (message.document && message.document.attributes) {
    for (const attr of message.document.attributes) {
      if (attr.ttl_seconds && attr.ttl_seconds > 0) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Получить TTL (время жизни) сообщения в секундах
 */
export function getTTL(message) {
  if (!message) return null;
  
  // Проверяем все возможные места хранения TTL
  if (message.photo && Array.isArray(message.photo)) {
    for (const photo of message.photo) {
      if (photo.ttl_seconds && photo.ttl_seconds > 0) {
        return photo.ttl_seconds;
      }
    }
  }
  
  if (message.video_note && message.video_note.ttl_seconds > 0) {
    return message.video_note.ttl_seconds;
  }
  
  if (message.video && message.video.ttl_seconds > 0) {
    return message.video.ttl_seconds;
  }
  
  if (message.voice && message.voice.ttl_seconds > 0) {
    return message.voice.ttl_seconds;
  }
  
  if (message.document && message.document.attributes) {
    for (const attr of message.document.attributes) {
      if (attr.ttl_seconds && attr.ttl_seconds > 0) {
        return attr.ttl_seconds;
      }
    }
  }
  
  return null;
}

/**
 * Получает FILE_ID медиа из сообщения
 * Это ключевой момент — file_id позволяет скачать файл даже после удаления
 */
export function getMediaFileId(message) {
  if (!message) return null;
  
  // Фото — берем последнее (самое большое разрешение)
  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    const lastPhoto = message.photo[message.photo.length - 1];
    return lastPhoto.file_id || null;
  }
  
  // Видео-заметка (кружок)
  if (message.video_note && message.video_note.file_id) {
    return message.video_note.file_id;
  }
  
  // Видео
  if (message.video && message.video.file_id) {
    return message.video.file_id;
  }
  
  // Голосовое
  if (message.voice && message.voice.file_id) {
    return message.voice.file_id;
  }
  
  // Документ
  if (message.document && message.document.file_id) {
    return message.document.file_id;
  }
  
  // Анимация (GIF)
  if (message.animation && message.animation.file_id) {
    return message.animation.file_id;
  }
  
  return null;
}

/**
 * Получает UNIQUE_ID медиа (для обнаружения повторов)
 */
export function getMediaUniqueId(message) {
  if (!message) return null;
  
  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    const lastPhoto = message.photo[message.photo.length - 1];
    return lastPhoto.file_unique_id || null;
  }
  
  if (message.video_note && message.video_note.file_unique_id) {
    return message.video_note.file_unique_id;
  }
  
  if (message.video && message.video.file_unique_id) {
    return message.video.file_unique_id;
  }
  
  if (message.voice && message.voice.file_unique_id) {
    return message.voice.file_unique_id;
  }
  
  if (message.document && message.document.file_unique_id) {
    return message.document.file_unique_id;
  }
  
  if (message.animation && message.animation.file_unique_id) {
    return message.animation.file_unique_id;
  }
  
  return null;
}

/**
 * Определяет тип медиа
 */
export function getMediaType(message) {
  if (!message) return null;
  
  if (message.photo) return 'photo';
  if (message.video_note) return 'video_note';
  if (message.video) return 'video';
  if (message.voice) return 'voice';
  if (message.document) return 'document';
  if (message.animation) return 'animation';
  if (message.sticker) return 'sticker';
  
  return null;
}

/**
 * Сохраняет медиа с приоритетом для самоуничтожающихся
 */
export function prepareSelfDestructSave(message, ownerTgId) {
  const type = getMediaType(message);
  const fileId = getMediaFileId(message);
  const uniqueId = getMediaUniqueId(message);
  const ttl = getTTL(message);
  const isSelfDestruct = isSelfDestructing(message);
  
  if (!fileId) {
    return { 
      saved: false, 
      reason: 'no_file_id',
      message: 'Не удалось получить file_id медиа'
    };
  }
  
  return {
    saved: true,
    isSelfDestruct: isSelfDestruct,
    ttlSeconds: ttl,
    mediaType: type,
    fileId: fileId,
    uniqueId: uniqueId,
    ownerTgId: ownerTgId,
    savedAt: new Date().toISOString(),
  };
}