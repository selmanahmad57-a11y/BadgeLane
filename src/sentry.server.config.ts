import * as Sentry from "@sentry/nextjs";

import {
  isServerSentryEnabled,
  observabilityEnv,
} from "@/config/env.observability";

/**
 * Sentry côté serveur Node.
 *
 * Sans `SENTRY_DSN`, `Sentry.init` reçoit un DSN indéfini : le SDK s'installe en
 * mode inactif, n'émet aucune requête réseau et ne bloque pas le démarrage.
 * Aucun garde supplémentaire n'est nécessaire dans le reste du code.
 */
Sentry.init({
  dsn: observabilityEnv.SENTRY_DSN,
  enabled: isServerSentryEnabled,
  tracesSampleRate: observabilityEnv.SENTRY_TRACES_SAMPLE_RATE,
});
