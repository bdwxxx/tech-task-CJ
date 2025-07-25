import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { DateTime } from 'luxon';

export interface DayPeriod {
    startTimestamp: number; // unix timestamp
    endTimestamp: number;   // unix timestamp
}

const log = logger(import.meta);

export class TimeService {
    public getCurrentDayPeriod(timezone: string): DayPeriod {
        const now = DateTime.now().setZone(timezone);
        const startTimestamp = Math.floor(now.startOf('day').toSeconds());
        const endTimestamp = Math.floor(now.endOf('day').toSeconds());
        
        log.info(`Рассчитан период: с ${now.startOf('day').toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')} по ${now.endOf('day').toFormat('yyyy-MM-dd HH:mm:ss ZZZZ')}`);

        return { startTimestamp, endTimestamp };
    }

        public calculateNewFinalizationTimestamp(delayDays: number): number {
        const newDate = DateTime.now()
            .setZone(config.app.accountTimezone)
            .plus({ days: delayDays })
            .set({
                hour: config.app.newFinalizationTime.hours,
                minute: config.app.newFinalizationTime.minutes,
                second: config.app.newFinalizationTime.seconds,
                millisecond: 0
            });
        return Math.floor(newDate.toSeconds());
    }
}