import { config } from "../config.js";
import { TelegramService } from "../services/telegram.service.js";
import { logger } from "../utils/logger.js";

const log = logger(import.meta);

export class SendNotificationUsecase {
    hasLimitExceededNotified = false;
    
    constructor(
        private telegramService: TelegramService
    ) {}

    public async execute(grossVolume: number, dailyLimit: number, idAccount: string): Promise<void> {
        if (!this.hasLimitExceededNotified) {
        log.warn(`ЛИМИТ ВПЕРВЫЕ ПРЕВЫШЕН! (${grossVolume.toFixed(2)} >= ${dailyLimit}). Отправка уведомления...`);
                        
        const message = `
        🚨 *Превышен дневной лимит!* 🚨

        👤 **Аккаунт:** \`${idAccount}\`

        📉 **Лимит:** \`${dailyLimit.toFixed(2)} ${config.app.currency.toUpperCase()}\`
        📈 **Текущий объем:** \`${grossVolume.toFixed(2)} ${config.app.currency.toUpperCase()}\`
        
        ✅ *Запущен процесс переноса инвойсов.*
                        `;
        await this.telegramService.sendNotification(message);
        
        this.hasLimitExceededNotified = true;
        } else {
            log.info(`Лимит превышен, но уведомление уже было отправлено сегодня.`);
        }
    }

    /**
     * Сбрасывает состояние флага уведомления.
     */
    resetNotificationState() {
        this.hasLimitExceededNotified = false;
        log.info('Состояние уведомления о лимите сброшено на новый день.');
    }}