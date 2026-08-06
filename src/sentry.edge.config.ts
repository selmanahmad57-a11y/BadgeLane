import * as Sentry from "@sentry/nextjs";

import {
  isServerSentryEnabled,
  observabilityEnv,
} from "@/config/env.observability";

/**
 * Sentry pour le runtime Edge — celui qui exécute `src/proxy.ts`.
 * Même contrat que la configuration Node : sans DSN, le SDK reste inactif.
 */
Sentry.init({
  dsn: observabilityEnv.SENTRY_DSN,
  enabled: isServerSentryEnabled,
  tracesSampleRate: observabilityEnv.SENTRY_TRACES_SAMPLE_RATE,
});
