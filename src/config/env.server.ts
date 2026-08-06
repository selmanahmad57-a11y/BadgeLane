import "server-only";

import { z } from "zod";

import {
  formatEnvError,
  optionalPositiveInt,
  optionalString,
  requiredString,
} from "./env.shared";

/**
 * Environnement serveur : secrets et réglages jamais exposés au navigateur.
 *
 * `server-only` fait échouer le build si ce module est importé, même
 * indirectement, depuis un composant client.
 */

/** Identifiant de fuseau IANA, ex. `America/New_York`. Validé par l'API Intl. */
const ianaTimeZone = requiredString.refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value as string });
      return true;
    } catch {
      return false;
    }
  },
  { message: "doit être un fuseau horaire IANA valide (ex. America/New_York)" },
);

/** Code devise ISO 4217, ex. `USD`. */
const currencyCode = requiredString.refine(
  (value) => /^[A-Z]{3}$/.test(value as string),
  { message: "doit être un code devise ISO 4217 en majuscules (ex. USD)" },
);

/** Code pays ISO 3166-1 alpha-2, ex. `US`. */
const countryCode = requiredString.refine(
  (value) => /^[A-Z]{2}$/.test(value as string),
  { message: "doit être un code pays ISO 3166-1 alpha-2 (ex. US)" },
);

const serverEnvSchema = z.object({
  /** Chaîne de connexion Neon (utiliser l'URL *pooled*). */
  DATABASE_URL: requiredString,

  /**
   * Taille max du pool de connexions. Laisser vide pour conserver la valeur
   * par défaut du driver — à ajuster seulement si Neon signale une saturation.
   */
  DATABASE_POOL_MAX: optionalPositiveInt,

  /** Clé secrète Clerk (`sk_test_…` / `sk_live_…`). */
  CLERK_SECRET_KEY: requiredString,

  /**
   * Secret de signature des webhooks Clerk. Facultatif tant que les webhooks
   * ne sont pas branchés ; la route de webhook refuse les requêtes sans lui.
   */
  CLERK_WEBHOOK_SIGNING_SECRET: optionalString,

  /**
   * Valeurs appliquées à une école nouvellement créée, avant que son admin ne
   * les modifie dans les réglages. Elles dépendent du marché visé : ce sont des
   * réglages de déploiement, pas des constantes du produit.
   */
  DEFAULT_ORGANIZATION_TIMEZONE: ianaTimeZone,
  DEFAULT_ORGANIZATION_CURRENCY: currencyCode,
  DEFAULT_ORGANIZATION_COUNTRY: countryCode,
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw formatEnvError("serveur", parsed.error, ".env.local.example");
}

export const serverEnv = parsed.data;

export type ServerEnv = typeof serverEnv;
