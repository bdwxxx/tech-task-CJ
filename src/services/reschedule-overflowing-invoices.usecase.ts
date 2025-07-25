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
            await this.rescheduleInvoicesForToday(period);
        } else {
            const remaining = config.app.dailyLimitAED - grossVolume;
            log.info(`Лимит в норме. Осталось: ${remaining.toFixed(2)} ${config.app.currency.toUpperCase()}`);
        }
    }

    private async rescheduleInvoicesForToday(period: DayPeriod): Promise<void> {
        const invoicesToReschedule = await this.stripeService.findInvoicesFinalizingToday(period);

        if (invoicesToReschedule.length === 0) {
            log.info('Не найдено инвойсов для переноса.');
            return;
        }

        log.info(`Найдено ${invoicesToReschedule.length} инвойсов для переноса:`);

        invoicesToReschedule.forEach((invoice, index) => {
            const amount = invoice.amount_due / 100;
            const currency = invoice.currency.toUpperCase();
            log.info(`  ${index + 1}. ${invoice.id} - ${amount} ${currency} (${invoice.status}, ${invoice.collection_method})`);
        });

        log.info(`Применение цикличной схемы переноса...`);
        let processedCount = 0;
        let errorCount = 0;

        for (const [index, invoice] of invoicesToReschedule.entries()) {
            if (!invoice.id) {
                log.warn(`Пропуск инвойса без ID на позиции ${index + 1}`);
                continue;
            }

            try {
                const detailedInvoice = await this.stripeService.getInvoiceDetails(invoice.id);
                
                const delayDays = config.app.delayCycleDays[index % config.app.delayCycleDays.length];
                const newTimestamp = this.timeService.calculateNewFinalizationTimestamp(delayDays);
                const newDateStr = DateTime.fromSeconds(newTimestamp, { 
                    zone: config.app.accountTimezone 
                }).toLocaleString(DateTime.DATETIME_FULL);

                log.info(`[${index + 1}/${invoicesToReschedule.length}] Обработка инвойса ${invoice.id}:`);
                log.info(`Сумма: ${detailedInvoice.amount_due / 100} ${detailedInvoice.currency.toUpperCase()}`);
                log.info(`Задержка: +${delayDays} дней`);
                log.info(`Новая дата: ${newDateStr}`);

                if (config.app.dryRun) {
                    log.warn(`[DRY RUN] Обновление пропущено (тестовый режим)`);
                    processedCount++;
                } else {
                    await this.stripeService.rescheduleInvoice(detailedInvoice, newTimestamp);
                    processedCount++;
                    log.info(`Успешно перенесен`);
                }

                await this.sleep(100);

            } catch (error) {
                errorCount++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Ошибка при переносе инвойса ${invoice.id}: ${errorMessage}`);
                
                continue;
            }
        }

        log.info(`ИТОГИ ПЕРЕНОСА:`);
        log.info(`Успешно обработано: ${processedCount}`);
        log.info(`Ошибок: ${errorCount}`);
        log.info(`Всего инвойсов: ${invoicesToReschedule.length}`);

        if (processedCount === invoicesToReschedule.length && errorCount === 0) {
            log.info(`Все инвойсы успешно перенесены!`);
        } else if (errorCount > 0) {
            log.warn(`Обработка завершена с ошибками`);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public async checkSystemStatus(): Promise<void> {
        log.info('Проверка текущего состояния системы...');
        
        const period = this.timeService.getCurrentDayPeriod(config.app.accountTimezone);
        const grossVolume = await this.stripeService.getGrossVolume(period.startTimestamp, period.endTimestamp);
        const invoicesForToday = await this.stripeService.findInvoicesFinalizingToday(period);
        
        log.info(`Текущий Gross Volume: ${grossVolume} ${config.app.currency.toUpperCase()}`);
        log.info(`Инвойсов к обработке сегодня: ${invoicesForToday.length}`);
        log.info(`Лимит: ${config.app.dailyLimitAED} ${config.app.currency.toUpperCase()}`);
        log.info(`Режим: ${config.app.dryRun ? 'DRY RUN' : 'PRODUCTION'}`);

        if (grossVolume >= config.app.dailyLimitAED) {
            log.warn(`Лимит превышен! Потребуется перенос инвойсов.`);
        } else {
            log.info(`Лимит в норме.`);
        }
    }
}