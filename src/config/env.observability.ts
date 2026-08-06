import { z } from "zod";

import { optionalRatio, optionalString } from "./env.shared";

/**
 * Configuration Sentry côté serveur et edge.
 *
 * Délibérément séparée de `env.server.ts` et sans `server-only` : les fichiers
 * d'initialisation Sentry sont chargés très tôt (via `instrumentation.ts`) et
 * dans plusieurs runtimes. L'observabilité ne doit dépendre ni de la base de
 * données ni de l'authentification.
 *
 * Tout est facultatif : sans DSN, le SDK s'initialise en mode inactif et
 * l'application démarre normalement.
 */
const observabilityEnvSchema = z.object({
  SENTRY_DSN: optionalString,
  SENTRY_TRACES_SAMPLE_RATE: optionalRatio,
});

export const observabilityEnv = observabilityEnvSchema.parse(process.env);

export const isServerSentryEnabled = Boolean(observabilityEnv.SENTRY_DSN);
