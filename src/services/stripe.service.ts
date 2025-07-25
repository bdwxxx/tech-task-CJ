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

    public async findInvoicesFinalizingToday(period: { startTimestamp: number, endTimestamp: number }): Promise<Stripe.Invoice[]> {
        const invoicesToProcess: Stripe.Invoice[] = [];
        
        const draftsResult = await this.stripe.invoices.list({ 
            status: 'draft', 
            limit: 100 
        });
        
        log.info(`Всего найдено черновиков: ${draftsResult.data.length}`);

        const autoAdvancingDrafts = draftsResult.data.filter(invoice => {
            if (!invoice.auto_advance) return false;
            
            const finalizesAt = invoice.automatically_finalizes_at;
            const isToday = finalizesAt && finalizesAt >= period.startTimestamp && finalizesAt <= period.endTimestamp;
            
            if (isToday) {
                log.info(`Найден auto-advancing draft: ${invoice.id}, финализация: ${new Date(finalizesAt * 1000).toISOString()}`);
            }
            
            return isToday;
        });

        invoicesToProcess.push(...autoAdvancingDrafts);

        const openResult = await this.stripe.invoices.list({ 
            status: 'open', 
            limit: 100 
        });
        
        log.info(`Всего найдено открытых инвойсов: ${openResult.data.length}`);

        const openInvoicesDueToday = openResult.data.filter(invoice => {
            const dueDate = invoice.due_date;
            const isDueToday = dueDate && dueDate >= period.startTimestamp && dueDate <= period.endTimestamp;
            
            if (isDueToday) {
                log.info(`Найден открытый инвойс со сроком сегодня: ${invoice.id}, due_date: ${new Date(dueDate * 1000).toISOString()}`);
            }
            
            return isDueToday;
        });

        invoicesToProcess.push(...openInvoicesDueToday);

        const sorted = invoicesToProcess.sort((a, b) => a.created - b.created);
        
        log.info(`Всего найдено инвойсов для обработки: ${sorted.length}`);
        
        return sorted;
    }

    public async rescheduleInvoice(invoice: Stripe.Invoice, newTimestamp: number): Promise<void> {
        const updatePayload: Stripe.InvoiceUpdateParams = {};
        const newDate = new Date(newTimestamp * 1000).toISOString();
        
        log.info(`Перенос инвойса ${invoice.id}:`);
        log.info(`Статус: ${invoice.status}`);
        log.info(`Collection method: ${invoice.collection_method}`);
        log.info(`Auto advance: ${invoice.auto_advance}`);
        log.info(`Новая дата: ${newDate}`);

        if (invoice.status === 'draft') {
            updatePayload.automatically_finalizes_at = newTimestamp;
            
            if (invoice.collection_method === 'send_invoice') {
                updatePayload.due_date = newTimestamp;
                log.info(`Обновление: automatically_finalizes_at + due_date`);
            } else {
                log.info(`Обновление: только automatically_finalizes_at`);
            }
            
        } else if (invoice.status === 'open') {
            updatePayload.due_date = newTimestamp;
            log.info(`Обновление: due_date для открытого инвойса`);
            
            if (invoice.collection_method === 'charge_automatically') {
                log.info(`Автоматическая оплата, следующая попытка будет перенесена`);
            }
        }

        try {
            await this.stripe.invoices.update(invoice.id!, updatePayload);
            log.info(`Инвойс ${invoice.id} успешно перенесен на ${newDate}`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error(`Ошибка при переносе инвойса ${invoice.id}: ${errorMsg}`);
            throw error;
        }
    }

    public async getInvoiceDetails(invoiceId: string): Promise<Stripe.Invoice> {
        try {
            const invoice = await this.stripe.invoices.retrieve(invoiceId);
            log.info(`Детали инвойса ${invoiceId}:`);
            log.info(`Статус: ${invoice.status}`);
            log.info(`Сумма: ${invoice.amount_due / 100} ${invoice.currency.toUpperCase()}`);
            log.info(`Collection method: ${invoice.collection_method}`);
            log.info(`Auto advance: ${invoice.auto_advance}`);
            log.info(`Due date: ${invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : 'не установлен'}`);
            log.info(`Automatically finalizes at: ${invoice.automatically_finalizes_at ? new Date(invoice.automatically_finalizes_at * 1000).toISOString() : 'не установлен'}`);
            
            return invoice;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error(`Ошибка получения деталей инвойса ${invoiceId}: ${errorMsg}`);
            throw error;
        }
    }
}