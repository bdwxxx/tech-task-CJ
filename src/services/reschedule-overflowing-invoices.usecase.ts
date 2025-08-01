import { StripeService } from './stripe.service.js'; 
import { TimeService, DayPeriod } from './time.service.js';
import { config } from '../config.js'; 
import { logger } from '../utils/logger.js';
import { DateTime } from 'luxon';
import axios from 'axios';
import { Stripe } from 'stripe';
import { TelegramService } from './telegram.service.js';
import { SendNotificationUsecase } from '../usecases/send-notification.js';

const log = logger(import.meta);

export class RescheduleOverflowingInvoicesUsecase {

    constructor(
        private stripeService: StripeService,
        private timeService: TimeService,
        private telegram: SendNotificationUsecase,
        private getIdAccount: () => string
    ) {}

    public async run(dailyLimit: number): Promise<void> {
        log.info('Запуск основного процесса...');
        
        const period = this.timeService.getCurrentDayPeriod(config.app.accountTimezone);
        const grossVolume = await this.stripeService.getGrossVolume(period.startTimestamp, period.endTimestamp);

        log.info(`Gross Volume за сегодня: ${grossVolume} ${config.app.currency.toUpperCase()}`);
        log.info(`Дневной лимит: ${dailyLimit} ${config.app.currency.toUpperCase()}`);

        if (grossVolume >= dailyLimit) {
            this.telegram.execute(grossVolume, dailyLimit, this.getIdAccount())
            
            log.warn(`Начинаем перенос инвойсов...`);
            await this.rescheduleDraftsForToday(period);
        } else {
            const remaining = dailyLimit - grossVolume;
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
                    await this.reportTransferToGateway(invoice);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.error(`Не удалось перенести инвойс ${invoice.id}. Причина: ${errorMessage}`);
            }
        }
        log.info('Процесс переноса черновиков завершен.');
    }

    private async reportTransferToGateway(invoice: Stripe.Invoice): Promise<void> {
    const gatewayUrl = process.env.GATEWAY_INTERNAL_URL;
    const gatewaySecret = process.env.GATEWAY_SECRET;
    const idAccount = this.getIdAccount();

    if (!gatewayUrl || !gatewaySecret || !idAccount) {
      log.error('URL/секрет/ID для Gateway не установлены. Лог не отправлен.');
      return;
    }

    try {
      log.info(`Отправка лога о переносе инвойса ${invoice.id} на Gateway...`);
      await axios.post(
        `${gatewayUrl}/admin/workers/internal/log-transfer`, 
        {
          workerId: idAccount,
          stripeInvoiceId: invoice.id,
          amount: invoice.amount_due / 100, // Stripe возвращает сумму в центах
          currency: invoice.currency,
        },
        { headers: { Authorization: `Bearer ${gatewaySecret}` } }
      );
      log.info(`Лог для инвойса ${invoice.id} успешно отправлен.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Не удалось отправить лог для инвойса ${invoice.id}. Ошибка: ${errorMessage}`);
    }
  }
}


