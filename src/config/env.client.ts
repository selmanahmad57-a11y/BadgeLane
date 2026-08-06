import { z } from "zod";

import {
  formatEnvError,
  optionalRatio,
  optionalString,
  requiredString,
  requiredStringList,
  requiredUrl,
} from "./env.shared";

/**
 * Environnement exposé au navigateur (préfixe `NEXT_PUBLIC_`).
 *
 * Ce module est importable depuis un composant client : il ne doit contenir
 * AUCUN secret. Les secrets vivent dans `env.server.ts`, protégé par
 * `server-only`.
 */
const clientEnvSchema = z
  .object({
    /** URL publique de l'application, utilisée pour les liens absolus. */
    NEXT_PUBLIC_APP_URL: requiredUrl,

    /** Langues activées, ex. `en,es`. Ajouter une langue = éditer cette variable. */
    NEXT_PUBLIC_SUPPORTED_LOCALES: requiredStringList,

    /** Langue utilisée quand celle du visiteur n'est pas supportée. */
    NEXT_PUBLIC_DEFAULT_LOCALE: requiredString,

    /** Clé publique Clerk (`pk_test_…` / `pk_live_…`). */
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: requiredString,

    /** Sentry navigateur — facultatif : sans DSN, le SDK reste inactif. */
    NEXT_PUBLIC_SENTRY_DSN: optionalString,
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: optionalRatio,
    NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: optionalRatio,
    NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE: optionalRatio,
  })
  .refine(
    (env) =>
      env.NEXT_PUBLIC_SUPPORTED_LOCALES.includes(env.NEXT_PUBLIC_DEFAULT_LOCALE),
    {
      path: ["NEXT_PUBLIC_DEFAULT_LOCALE"],
      message:
        "la langue par défaut doit faire partie de NEXT_PUBLIC_SUPPORTED_LOCALES",
    },
  );

/**
 * Next.js n'inline que les accès *statiques* à `process.env.NEXT_PUBLIC_*`.
 * Un accès dynamique (`process.env[nom]`) renverrait `undefined` côté client :
 * chaque variable doit donc être listée littéralement ici.
 */
const rawClientEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPPORTED_LOCALES: process.env.NEXT_PUBLIC_SUPPORTED_LOCALES,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE:
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE:
    process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE:
    process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
};

const parsed = clientEnvSchema.safeParse(rawClientEnv);

if (!parsed.success) {
  throw formatEnvError("client", parsed.error, ".env.local.example");
}

export const clientEnv = parsed.data;

export type ClientEnv = typeof clientEnv;
