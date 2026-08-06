import * as Sentry from "@sentry/nextjs";

import { clientEnv } from "@/config/env.client";

/**
 * Sentry côté navigateur.
 *
 * Les taux d'échantillonnage ne sont pas fixés dans le code : laissés vides, ils
 * restent `undefined` et la fonctionnalité correspondante est simplement
 * désactivée. C'est en production, DSN en main, que ces valeurs se règlent.
 */
Sentry.init({
  dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(clientEnv.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: clientEnv.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  replaysSessionSampleRate:
    clientEnv.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  replaysOnErrorSampleRate:
    clientEnv.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
});

/** Instrumente les transitions de navigation côté client. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
