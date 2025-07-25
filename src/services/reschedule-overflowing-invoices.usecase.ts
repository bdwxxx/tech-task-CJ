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

        if (grossVolume < config.app.dailyLimitAED) {
            log.info(`Лимит ${config.app.dailyLimitAED} ${config.app.currency.toUpperCase()} не достигнут. Работа завершена.`);
            return;
        }

        log.info(`Дневной лимит достигнут! Начинаю перенос инвойсов.`);
        await this.processInvoices(period);
    }

     private async processInvoices(period: DayPeriod): Promise<void> {
        const invoicesToProcess = await this.stripeService.getUntouchedOpenInvoices(period);

        if (invoicesToProcess.length === 0) {
            log.info('Необработанных инвойсов для переноса не найдено.');
            return;
        }

        let processedCount = 0;
        for (const [index, invoice] of invoicesToProcess.entries()) {
            try {
                if (checkInvoiceValid(invoice) === false) {
                    log.warn(`Пропущен инвойс с некорректным ID: ${invoice.id}`);
                    continue; 
                }

                const baseDate = period.startTimestamp;
                const delayDays = config.app.delayCycleDays[index % config.app.delayCycleDays.length];
                const newDueDateTimestamp = this.timeService.calculateNewDueDate(baseDate, delayDays, config.app.newDueTime);

                log.info(`\n -> Обработка инвойса ${invoice.id}:`);
                log.info(`    Текущая дата оплаты: ${invoice.due_date ? DateTime.fromSeconds(invoice.due_date, { zone: config.app.accountTimezone }).toFormat('yyyy-MM-dd') : 'Нет'}`);
                log.info(`    Применяемое смещение: +${delayDays} дней от сегодня.`);

                if (config.app.dryRun == true) {
                    log.info(`dry-run --- Инвойс ${invoice.id} НЕ обновлён. Новая дата: ${DateTime.fromSeconds(newDueDateTimestamp, { zone: config.app.accountTimezone }).toISO()}`);
                } else {
                    await this.stripeService.rescheduleInvoice(invoice.id as string, newDueDateTimestamp);
                    log.info(`Инвойс ${invoice.id} обновлён. Новая дата: ${DateTime.fromSeconds(newDueDateTimestamp, { zone: config.app.accountTimezone }).toISO()}`);
                }
                
                processedCount++;

            } catch (error) {
                const invoiceId = invoice.id || 'ID НЕИЗВЕСТЕН';
                log.warn(`Не удалось обработать инвойс ${invoiceId}. Скрипт продолжит работу со следующими инвойсами.`);
                log.warn(`   Причина: ${error}`);
            }
        }

        log.info(`\nПроцесс завершен. Успешно перенесено инвойсов: ${processedCount} из ${invoicesToProcess.length}.`);
    }
}

function checkInvoiceValid(invoice: Stripe.Invoice): boolean {
    return typeof invoice.id === 'string' && !!invoice.id;
}