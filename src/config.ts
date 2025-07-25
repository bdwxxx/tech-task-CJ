import 'dotenv/config';

if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Переменная окружения STRIPE_SECRET_KEY не установлена');
}

export const config = {
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY,
    },
    app: {
        accountTimezone: 'Etc/GMT-4',
        delayCycleDays: [1, 3, 5, 7, 9],
        newFinalizationTime: { hours: 12, minutes: 0, seconds: 0 }, 

        dailyLimitAED: 30,
        currency: 'aed', 

        dryRun: process.env.DRY_RUN === 'true',
    },
};