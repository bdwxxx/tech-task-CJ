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

    public calculateNewDueDate(baseTimestamp: number, delayDays: number, dueTime: { hours: number; minutes: number; seconds: number }): number {
        const tz = config.app.accountTimezone;
        const base = DateTime.fromSeconds(baseTimestamp, { zone: tz });
        const target = base.plus({ days: delayDays }).set({
            hour: dueTime.hours,
            minute: dueTime.minutes,
            second: dueTime.seconds,
            millisecond: 0
        });
        return Math.floor(target.toUTC().toSeconds());
    }
}