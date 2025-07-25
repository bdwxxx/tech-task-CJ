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

    public async findFinalizingDrafts(): Promise<Stripe.Invoice[]> {
        const result = await this.stripe.invoices.list({
            status: 'draft',
            limit: 100,
        });
        const activeDrafts = result.data.filter(invoice => invoice.auto_advance !== false);
        log.info(`Найдено активных черновиков для потенциального переноса: ${activeDrafts.length}`);
        return activeDrafts;
    }

    public async rescheduleDraftFinalization(invoiceId: string, newFinalizationTimestamp: number): Promise<void> {
        await this.stripe.invoices.update(invoiceId, {
            collection_method: 'send_invoice',
            due_date: newFinalizationTimestamp,
        });
        log.info(`Для черновика ${invoiceId} перенесена дата финализации и оплаты на ${new Date(newFinalizationTimestamp * 1000).toISOString()}`);
    }


}