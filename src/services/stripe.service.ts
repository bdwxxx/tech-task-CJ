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
        log.info(`Получение Gross Volume (с учетом всех валют)...`);

        const charges: Stripe.Charge[] = [];
        const events = this.stripe.events.list({
            created: { gte: startTimestamp, lte: endTimestamp },
            type: 'charge.succeeded',
            limit: 100,
        });

        for await (const event of events) {
            charges.push(event.data.object as Stripe.Charge);
        }

        if (charges.length === 0) {
            log.info(`Успешных платежей за период не найдено.`);
            return 0;
        }

        const promises = charges.map(charge => {
            if (!charge.balance_transaction || typeof charge.balance_transaction !== 'string') {
                log.warn(`У платежа ${charge.id} нет ID транзакции по балансу, пропускаем.`);
                return Promise.resolve(null);
            }
            return this.stripe.balanceTransactions.retrieve(charge.balance_transaction);
        });

        const results = await Promise.allSettled(promises);
        let grossVolumeCents = 0;

        results.forEach((result, index) => {
            const originalCharge = charges[index];

            if (result.status === 'fulfilled' && result.value) {
                const balanceTransaction = result.value;
                grossVolumeCents += balanceTransaction.amount;

                const originalAmount = (originalCharge.amount / 100).toFixed(2);
                const settledAmount = (balanceTransaction.amount / 100).toFixed(2);

                if (originalCharge.currency.toUpperCase() !== balanceTransaction.currency.toUpperCase()) {
                    log.info(`Платеж ${originalCharge.id}: ${originalAmount} ${originalCharge.currency.toUpperCase()} -> ${settledAmount} ${balanceTransaction.currency.toUpperCase()}`);
                } else {
                    log.info(`Платеж ${originalCharge.id}: ${settledAmount} ${balanceTransaction.currency.toUpperCase()}`);
                }

            } else if (result.status === 'rejected') {
                log.error(`Не удалось получить транзакцию для платежа ${originalCharge.id}. Ошибка: ${result.reason}`);
            }
        });

        const grossVolume = grossVolumeCents / 100;
        log.info(`Итоговый Gross Volume за период (все валюты): ${grossVolume.toFixed(2)} AED`);
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