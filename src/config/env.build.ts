import { z } from "zod";

import { optionalString } from "./env.shared";

/**
 * Variables lues uniquement au moment du *build* (par `next.config.ts`).
 *
 * Volontairement séparé de `env.server.ts` : un build doit pouvoir aboutir sans
 * base de données ni clé d'authentification. Tout est facultatif ici — leur
 * absence désactive simplement l'upload des source maps vers Sentry.
 */
const buildEnvSchema = z.object({
  SENTRY_ORG: optionalString,
  SENTRY_PROJECT: optionalString,
  SENTRY_AUTH_TOKEN: optionalString,
});

export const buildEnv = buildEnvSchema.parse(process.env);

/**
 * L'upload des source maps n'est tenté que si les trois valeurs sont présentes :
 * un token sans organisation (ou l'inverse) ferait échouer le build en CI.
 */
export const isSentryBuildUploadEnabled = Boolean(
  buildEnv.SENTRY_ORG && buildEnv.SENTRY_PROJECT && buildEnv.SENTRY_AUTH_TOKEN,
);
