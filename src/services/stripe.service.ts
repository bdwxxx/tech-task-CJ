import Stripe from 'stripe';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { DayPeriod } from './time.service.js';
import { DateTime } from 'luxon';

const log = logger(import.meta);

export class StripeService {
    private stripe: Stripe;

    constructor() {
        this.stripe = new Stripe(config.stripe.secretKey, {
            typescript: true,
        });
        log.info('Сервис инициализирован.');
    }

    public async getGrossVolume(startTimestamp: number, endTimestamp: number): Promise<number> {
        log.info(`Получение Gross Volume`);
        let grossVolumeCents = 0;

        const events = this.stripe.events.list({
            created: { gte: startTimestamp, lte: endTimestamp },
            type: 'charge.succeeded', 
            limit: 100, 
        });

        for await (const event of events) {
            const charge = event.data.object as Stripe.Charge;

            if (charge.currency.toLowerCase() === config.app.currency) {
                grossVolumeCents += charge.amount;
            }
        }
        
        const grossVolume = grossVolumeCents / 100;
        log.info(`Gross Volume за период (по событиям): ${grossVolume.toFixed(2)} ${config.app.currency.toUpperCase()}`);
        return grossVolume;
    }

    public async getUntouchedOpenInvoices(period: DayPeriod): Promise<Stripe.Invoice[]> {
        log.info(`Выполняю поиск инвойсов с due_date в периоде...`);
        
        const result = await this.stripe.invoices.list({
            status: 'open',
            due_date: {
                gte: period.startTimestamp,
                lte: period.endTimestamp,
            },
            limit: 100,
        });

        log.info(`Найдено ${result.data.length} инвойсов с датой оплаты сегодня.`);

        const untouchedInvoices = result.data.filter(invoice => {
            return !invoice.metadata || !invoice.metadata.invoice_rescheduled_on;
        });

        const sortedInvoices = untouchedInvoices.sort((a, b) => a.created - b.created);
        
        log.info(`Из них НЕОБРАБОТАННЫХ для переноса: ${sortedInvoices.length}`);
        return sortedInvoices;
    }

    public async rescheduleInvoice(invoiceId: string, newDueDateTimestamp: number): Promise<void> {
        await this.stripe.invoices.update(invoiceId, {
            due_date: newDueDateTimestamp,
             metadata: {
                invoice_rescheduled_on: DateTime.now().toISODate() 
             }
        });
        log.info(`Успешно перенесен инвойс ${invoiceId} и установлена метка.`);
    }

}