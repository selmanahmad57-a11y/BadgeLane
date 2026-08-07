import { z } from "zod";

import { optionalString } from "./env.shared";

/**
 * Clés Stripe, **toutes facultatives**.
 *
 * L'application doit démarrer, se construire et fonctionner sans compte
 * Stripe — une école qui n'a pas encore connecté le sien doit pouvoir utiliser
 * tout le reste du produit. Sans clé, la facturation s'affiche comme non
 * configurée au lieu de faire échouer le boot.
 *
 * Même contrat que Sentry : l'absence désactive proprement, elle ne casse rien.
 */
const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
});

export const stripeEnv = stripeEnvSchema.parse(process.env);

/** La facturation est-elle utilisable sur cette instance ? */
export const isStripeConfigured = Boolean(stripeEnv.STRIPE_SECRET_KEY);
