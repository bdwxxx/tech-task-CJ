import { Telegraf } from 'telegraf'; 
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const log = logger(import.meta);

export class TelegramService {
    private bot!: Telegraf; 

    constructor() {
        if (config.telegram.botToken) {
            this.bot = new Telegraf(config.telegram.botToken);
            this.bot.telegram.getMe().then((botInfo) => {
                log.info(`Telegram Bot @${botInfo.username} успешно инициализирован.`);
            }).catch((error) => {
                log.error(`Ошибка инициализации Telegram Bot: ${error}`);
            });
        }
    }

    /**
     * Отправляет уведомление в Telegram.
     * @param {string} message - Текст сообщения, поддерживающий Markdown.
     */
    async sendNotification(message: string): Promise<void> {
        if (!this.bot || !config.telegram.chatId) {
            log.warn('Попытка отправить уведомление, но сервис Telegram не настроен.');
            return;
        }

        try {
            await this.bot.telegram.sendMessage(config.telegram.chatId, message, {
                parse_mode: 'Markdown',
            });
            log.info('Уведомление в Telegram успешно отправлено');
        } catch (error) {
            log.error(`Ошибка при отправке уведомления в Telegram: ${error}`);
        }
    }
}