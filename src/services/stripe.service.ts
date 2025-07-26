import Stripe from 'stripe';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
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

    public async findDraftsToReschedule(period: { startTimestamp: number, endTimestamp: number }): Promise<Stripe.Invoice[]> {
        const result = await this.stripe.invoices.list({ status: 'draft', limit: 100 });
        log.info(`Всего найдено черновиков: ${result.data.length}. Фильтрация...`);

        const draftsToProcess = result.data.filter(invoice => {
            if (!invoice.auto_advance) return false;
            
            const finalizesAt = invoice.automatically_finalizes_at;
            return finalizesAt && finalizesAt >= period.startTimestamp && finalizesAt <= period.endTimestamp;
        });

        const sorted = draftsToProcess.sort((a, b) => a.created - b.created);
        log.info(`Найдено черновиков для переноса: ${sorted.length}`);
        return sorted;
    }

    public async rescheduleDraftInvoice(invoice: Stripe.Invoice, newTimestamp: number): Promise<void> {
        const updatePayload: Stripe.InvoiceUpdateParams = {
            automatically_finalizes_at: newTimestamp,
        };

        if (invoice.collection_method === 'send_invoice') {
            updatePayload.due_date = newTimestamp;
            log.info(`Обновление automatically_finalizes_at и due_date для инвойса ${invoice.id}`);
        } else {
            log.info(`Обновление только automatically_finalizes_at для инвойса ${invoice.id}`);
        }

        await this.stripe.invoices.update(invoice.id!, updatePayload);
        log.info(`Инвойс ${invoice.id} успешно перенесен.`);
    }
}