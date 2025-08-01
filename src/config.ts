import dotenv from 'dotenv';

dotenv.config();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY не установлен');
}

if (!process.env.WORKER_ACCOUNT_ID) {
  throw new Error('WORKER_ACCOUNT_ID не установлен');
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  console.warn('Переменные для Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) не установлены. Уведомления работать не будут.');
}

export const config = {
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
  },
  app: {
    idAccount: process.env.WORKER_ACCOUNT_ID,
    accountTimezone: 'Etc/GMT-4',
    delayCycleDays: [1, 3, 5, 7, 9],
    newFinalizationTime: { hours: 12, minutes: 0, seconds: 0 },
    currency: 'aed',

    initialDailyLimit: 30,
    dryRun: process.env.DRY_RUN === 'true',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  }
};