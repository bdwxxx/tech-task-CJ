import { config } from './config.js';
import { RescheduleOverflowingInvoicesUsecase } from './services/reschedule-overflowing-invoices.usecase.js';
import { StripeService } from './services/stripe.service.js';
import { TimeService } from './services/time.service.js';
import cron from 'node-cron';
import { logger } from './utils/logger.js';

const log = logger(import.meta);

async function runTask(): Promise<void> {
    
    const timeService = new TimeService();
    const stripeService = new StripeService();
    const rescheduleOverflowingInvoicesUsecase = new RescheduleOverflowingInvoicesUsecase(stripeService, timeService);

    try {
        await rescheduleOverflowingInvoicesUsecase.run();
    } catch (error) {
        log.error(`Произошла неизвестная ошибка: ${error}`);
    }
    log.info('Задача завершена.');
    }

log.info('Планировщик запущен. Ожидание запланированного времени...');

cron.schedule('* * * * *', () => {
    log.info(`Наступило время выполнения (${new Date().toISOString()}). Запускаю задачу...`);
    
    runTask().catch(e => {
        log.warn(`Непредвиденная ошибка: ${e}`);
    });
}, {
    timezone: config.app.accountTimezone 
});