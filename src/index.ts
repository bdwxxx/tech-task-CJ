import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { RescheduleOverflowingInvoicesUsecase } from './services/reschedule-overflowing-invoices.usecase.js';
import { StripeService } from './services/stripe.service.js';
import { TimeService } from './services/time.service.js';
import { Request, Response, NextFunction } from 'express';

const app = express();
app.use(express.json());
const log = logger(import.meta);

let currentDailyLimit = config.app.initialDailyLimit;

const timeService = new TimeService();
const stripeService = new StripeService();
const rescheduleUsecase = new RescheduleOverflowingInvoicesUsecase(stripeService, timeService, () => config.app.idAccount);

const verifyGateway = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token && token === process.env.GATEWAY_SECRET) {
    next(); 
  } else {
    log.warn(`Отклонен запрос без/с неверным токеном от ${req.ip}`);
    res.status(403).json({ error: 'Forbidden: Invalid or missing token.' });
  }
};

app.post('/update-limit', (req, res) => { // verifyGateway
  const { newLimit } = req.body;
  if (typeof newLimit !== 'number' || newLimit <= 0) {
    return res.status(400).json({ error: 'Неверное значение лимита.' });
  }
  
  currentDailyLimit = newLimit;
  log.info(`Дневной лимит обновлен через API на: ${currentDailyLimit}`);
  res.status(200).json({ success: true, newLimit: currentDailyLimit });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', currentLimit: currentDailyLimit });
});

app.get('/stats', async (req, res) => { // verifyGateway
  try {
    log.info('Получен запрос на статистику (/stats)');
    const period = timeService.getCurrentDayPeriod(config.app.accountTimezone);
    const grossVolume = await stripeService.getGrossVolume(period.startTimestamp, period.endTimestamp);
    
    // TODO: Реализовать подсчет перенесенных инвойсов (пока заглушка)
    const transferredInvoicesCount = 0; 

    res.status(200).json({
      grossVolume: grossVolume,
      transferredInvoicesToday: transferredInvoicesCount,
      currency: config.app.currency,
      currentDailyLimit: currentDailyLimit,
    });
  } catch (error) {
    log.error(`Ошибка при сборе статистики: ${error}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// --- ЛОГИКА КРОН-ЗАДАЧИ ---
async function runTask() {
  try {
    await rescheduleUsecase.run(currentDailyLimit);
  } catch (error) {
    log.error(`Произошла ошибка в задаче: ${error}`);
  }
}

log.info('Планировщик запущен.');
cron.schedule('* * * * *', () => {
  log.info('Наступило время выполнения задачи...');
  runTask().catch(e => log.warn(`Непредвиденная ошибка в крон-задаче: ${e}`));
}, { timezone: config.app.accountTimezone });


const host = '0.0.0.0';
const port = Number(process.env.PORT) || 3005;
app.listen(port, host, () => {
  log.info(`Воркер запущен и слушает на http://${host}:${port}`);
});