import express, { Request, Response, NextFunction } from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { RescheduleOverflowingInvoicesUsecase } from './services/reschedule-overflowing-invoices.usecase.js';
import { StripeService } from './services/stripe.service.js';
import { TimeService } from './services/time.service.js';
import { TelegramService } from './services/telegram.service.js';
import { SendNotificationUsecase } from './usecases/send-notification.js';
import { EncryptionService } from './services/encryption.service.js';

const app = express();
app.use(express.json());
const log = logger(import.meta);

interface IWorkerState {
  isInitialized: boolean;
  accountId: string | null;
  dailyLimit: number;
  stripeService: StripeService | null;
  timeService: TimeService;
  telegramService: TelegramService;
  sendNotificationUsecase: SendNotificationUsecase | null;
  rescheduleUsecase: RescheduleOverflowingInvoicesUsecase | null;
}

const workerState: IWorkerState = {
  isInitialized: false,
  accountId: config.app.idAccount,
  dailyLimit: config.app.initialDailyLimit,
  stripeService: null,
  timeService: new TimeService(),
  telegramService: new TelegramService(),
  sendNotificationUsecase: null,
  rescheduleUsecase: null,
};

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

app.post('/initialize', (req, res) => {
  if (workerState.isInitialized) {
    log.warn(`Попытка повторной инициализации воркера. accountId: ${workerState.accountId}`);
    return res.status(409).json({ error: 'Воркер уже инициализирован.' });
  }

  const { accountId, dailyLimit, encryptedApiKey } = req.body;
  if (!accountId || !dailyLimit || !encryptedApiKey) {
    return res.status(400).json({ error: 'Отсутствуют необходимые поля: accountId, dailyLimit, encryptedApiKey' });
  }

  try {
    const encryptionService = new EncryptionService();
    const stripeApiKey = encryptionService.decrypt(encryptedApiKey);
    
    workerState.accountId = accountId;
    workerState.dailyLimit = dailyLimit;
    workerState.stripeService = new StripeService(stripeApiKey);
    workerState.sendNotificationUsecase = new SendNotificationUsecase(workerState.telegramService);
    workerState.rescheduleUsecase = new RescheduleOverflowingInvoicesUsecase(
      workerState.stripeService, 
      workerState.timeService, 
      workerState.sendNotificationUsecase, 
      () => {
        if (workerState.accountId === null) {
          throw new Error('Критическая ошибка: accountId не должен быть null после инициализации.');
        }
        return workerState.accountId;
      }
    );

    workerState.isInitialized = true;
    log.info(`✅ Воркер успешно инициализирован. Account ID: ${accountId}, Daily Limit: ${dailyLimit}`);
    res.status(200).json({ success: true, message: 'Воркер инициализирован.' });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Критическая ошибка инициализации: ${errorMessage}`);
    res.status(500).json({ error: 'Ошибка на стороне воркера при инициализации.' });
  }
});

app.post('/update-limit', (req, res) => {
  if (!workerState.isInitialized) {
    return res.status(409).json({ error: 'Воркер не инициализирован.' });
  }
  const { newLimit } = req.body;
  if (typeof newLimit !== 'number' || newLimit <= 0) {
    return res.status(400).json({ error: 'Неверное значение лимита.' });
  }
  
  workerState.dailyLimit = newLimit;
  log.info(`Дневной лимит обновлен через API на: ${workerState.dailyLimit}`);
  res.status(200).json({ success: true, newLimit: workerState.dailyLimit });
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: workerState.isInitialized ? 'OK' : 'PENDING_INITIALIZATION', 
        currentLimit: workerState.dailyLimit 
    });
});

app.get('/stats', async (req, res) => {
  if (!workerState.isInitialized || !workerState.stripeService) {
    return res.status(409).json({ error: 'Воркер не инициализирован и не готов предоставлять статистику.' });
  }
  try {
    log.info('Получен запрос на статистику (/stats)');
    const period = workerState.timeService.getCurrentDayPeriod(config.app.accountTimezone);
    const grossVolume = await workerState.stripeService.getGrossVolume(period.startTimestamp, period.endTimestamp);
    
    const transferredInvoicesCount = 0; // TODO

    res.status(200).json({
      grossVolume: grossVolume,
      transferredInvoicesToday: transferredInvoicesCount,
      currency: config.app.currency,
      currentDailyLimit: workerState.dailyLimit,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Ошибка при сборе статистики: ${errorMessage}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- ЛОГИКА КРОН-ЗАДАЧИ ---
async function runTask() {
  if (!workerState.isInitialized || !workerState.rescheduleUsecase) {
    log.info('Пропуск выполнения крон-задачи: воркер не инициализирован.');
    return;
  }
  try {
    await workerState.rescheduleUsecase.run(workerState.dailyLimit);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Произошла ошибка в задаче: ${errorMessage}`);
  }
}

log.info('Планировщик запущен. Ожидание инициализации от Gateway...');
cron.schedule('* * * * *', () => {
  log.info('Наступило время выполнения задачи...');
  runTask().catch(e => {
      const errorMessage = e instanceof Error ? e.message : String(e);
      log.warn(`Непредвиденная ошибка в крон-задаче: ${errorMessage}`);
  });
}, { timezone: config.app.accountTimezone });

cron.schedule('1 0 * * *', () => {
    if (!workerState.isInitialized || !workerState.sendNotificationUsecase) {
        return; 
    }
    log.info('Сброс состояния ежедневного уведомления о лимите...');
    workerState.sendNotificationUsecase.resetNotificationState();
}, { timezone: config.app.accountTimezone });

const host = '0.0.0.0';
const port = Number(process.env.PORT) || 3005;
app.listen(port, host, () => {
  log.info(`Воркер запущен и слушает на http://${host}:${port}`);
});