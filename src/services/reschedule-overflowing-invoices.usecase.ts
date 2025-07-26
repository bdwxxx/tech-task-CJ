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

        log.info(`Gross Volume за сегодня: ${grossVolume} ${config.app.currency.toUpperCase()}`);
        log.info(`Дневной лимит: ${config.app.dailyLimitAED} ${config.app.currency.toUpperCase()}`);

        if (grossVolume >= config.app.dailyLimitAED) {
            log.warn(`Лимит превышен! (${grossVolume} >= ${config.app.dailyLimitAED})`);
            log.warn(`Начинаем перенос инвойсов...`);
            await this.rescheduleDraftsForToday(period);
        } else {
            const remaining = config.app.dailyLimitAED - grossVolume;
            log.info(`Лимит в норме. Осталось: ${remaining.toFixed(2)} ${config.app.currency.toUpperCase()}`);
        }
    }

   private async rescheduleDraftsForToday(period: DayPeriod): Promise<void> {
        const invoicesToReschedule = await this.stripeService.findDraftsToReschedule(period);

        if (invoicesToReschedule.length === 0) {
            log.info('Не найдено черновиков для переноса на сегодня.');
            return;
        }

        log.info(`Обнаружено ${invoicesToReschedule.length} черновиков для переноса. Применение циклической задержки...`);
        
        for (const [index, invoice] of invoicesToReschedule.entries()) {
            try {
                const delayDays = config.app.delayCycleDays[index % config.app.delayCycleDays.length];
                const newTimestamp = this.timeService.calculateNewFinalizationTimestamp(delayDays);
                const newDateStr = DateTime.fromSeconds(newTimestamp, { zone: config.app.accountTimezone }).toLocaleString(DateTime.DATETIME_FULL);

                log.info(`[${index + 1}/${invoicesToReschedule.length}] Обработка инвойса ${invoice.id}: задержка +${delayDays} дней, новая дата ${newDateStr}`);

                if (config.app.dryRun) {
                    log.warn(`[DRY RUN] Обновление инвойса ${invoice.id} пропущено.`);
                } else {
                    await this.stripeService.rescheduleDraftInvoice(invoice, newTimestamp);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Не удалось перенести инвойс ${invoice.id}. Причина: ${errorMessage}`);
            }
        }
        log.info('Процесс переноса черновиков завершен.');
    }
}