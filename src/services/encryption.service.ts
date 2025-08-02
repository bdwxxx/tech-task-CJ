import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const log = logger(import.meta);

const ENCRYPTION_SECRET_KEY = process.env.ENCRYPTION_SECRET_KEY;
if (!ENCRYPTION_SECRET_KEY || ENCRYPTION_SECRET_KEY.length !== 64) {
  throw new Error('ENCRYPTION_SECRET_KEY должен быть 64-символьной hex-строкой (32 байта)');
}

const key = Buffer.from(ENCRYPTION_SECRET_KEY, 'hex');
const ivLength = 16;
const algorithm = 'aes-256-gcm';

export class EncryptionService {
  decrypt(encryptedText: string) {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        throw new Error('Неверный формат зашифрованных данных');
      }
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');

      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      log.info('API ключ успешно расшифрован.');
      return decrypted.toString('utf8');
    } catch (error) {
      log.error(`Критическая ошибка при расшифровке ключа: ${error}`);
      throw new Error('Не удалось расшифровать API ключ.');
    }
  }
}