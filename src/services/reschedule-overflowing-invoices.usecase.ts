import { StripeService } from './stripe.service.js'; 
import { TimeService, DayPeriod } from './time.service.js';
import { config } from '../config.js'; 
import { logger } from '../utils/logger.js';
import Stripe from 'stripe';
import { DateTime } from 'luxon';

const log = logger(import.meta);

export class RescheduleOverflowingInvoicesUsecase {
    constructor(
        private stripeService: StripeService,
        private timeService: TimeService
    ) {}

    public async run(): Promise<void> {
        log.info('Запуск основного процесса...');
        
        const period = this.timeService.getCurrentDayPeriod(config.app.accountTimezone);
        const grossVolume = await this.stripeService.getGrossVolume(period.startTimestamp, period.endTimestamp);

        if (grossVolume >= config.app.dailyLimitAED) {
            log.warn(`Дневной лимит достигнут! Перенос черновиков.`);
            await this.rescheduleActiveDrafts();
        } else {
            log.info(`Лимит в норме. Вмешательство не требуется.`);
        }
    }

    private async rescheduleActiveDrafts(): Promise<void> {
        const draftsToProcess = await this.stripeService.findFinalizingDrafts();


        if (draftsToProcess.length === 0) {
            log.info('Активных черновиков, требующих переноса СЕГОДНЯ, не найдено.');
            return;
        }

        log.info(`Обнаружено ${draftsToProcess.length} черновиков для переноса. Начинаю распределение...`);
        let processedCount = 0;

        for (const [index, invoice] of draftsToProcess.entries()) {
            try {
                if (!checkInvoiceValid(invoice)) { continue; }
                
                const delayDays = config.app.delayCycleDays[index % config.app.delayCycleDays.length];
                const newFinalizationTimestamp = this.timeService.calculateNewDueDate(Date.now() / 1000, delayDays, config.app.newDueTime);

                log.info(`\n -> Обработка черновика ${invoice.id}:`);
                log.info(`    Применяемое смещение: +${delayDays} дней.`);
                log.info(`    Новая дата финализации будет: ${new Date(newFinalizationTimestamp * 1000).toISOString()}`);

                if (config.app.dryRun) {
                    log.info(`[DRY-RUN] Для инвойса ${invoice.id} НЕ была бы перенесена дата.`);
                } else {
                    await this.stripeService.rescheduleDraftFinalization(invoice.id!, newFinalizationTimestamp);
                }
                processedCount++;
            } catch (error) {
                log.error(`Не удалось перенести черновик ${invoice.id}. Причина: ${error}`);
            }
        }
        log.info(`\nПроцесс переноса черновиков завершен. Обработано: ${processedCount} из ${draftsToProcess.length}.`);
    }
}

function checkInvoiceValid(invoice: Stripe.Invoice): boolean {
    return typeof invoice.id === 'string' && !!invoice.id;
}