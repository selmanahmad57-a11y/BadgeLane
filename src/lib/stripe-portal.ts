import "server-only";

import type Stripe from "stripe";

import { CUSTOMER_PORTAL_FEATURES } from "@/config/billing";

import type { forConnectedAccount } from "./stripe";

/**
 * Le portail client de Stripe, sur le compte de l'école.
 *
 * ── Ce qu'il remplace ────────────────────────────────────────────────────────
 *
 * Rien à construire : Stripe sert déjà une page où le parent remplace sa carte
 * et consulte ses factures. Écrire la nôtre voudrait dire toucher aux moyens de
 * paiement, donc entrer dans le périmètre PCI que tout le modèle Connect
 * Standard sert justement à éviter (§6 du blueprint).
 *
 * ── À qui appartiennent les réglages ─────────────────────────────────────────
 *
 * L'école est le marchand : c'est **sa** configuration de portail qui doit
 * s'appliquer, y compris si elle l'a réglée elle-même dans son tableau de bord
 * Stripe. On ne l'écrase donc jamais.
 *
 * On n'en crée une que si le compte n'en a aucune — sans quoi l'ouverture du
 * portail échouerait avec « no configuration provided ». Nos réglages ne sont
 * alors qu'un point de départ raisonnable, que l'école reste libre de changer.
 */
export async function resolvePortalConfiguration(
  stripe: Stripe,
  scoped: ReturnType<typeof forConnectedAccount>,
): Promise<string | undefined> {
  const existing = await stripe.billingPortal.configurations.list(
    { active: true, limit: 1 },
    scoped,
  );

  /**
   * Le compte a déjà une configuration : on ne passe rien et Stripe applique
   * celle que l'école a désignée par défaut.
   */
  if (existing.data.length > 0) return undefined;

  const created = await stripe.billingPortal.configurations.create(
    { features: CUSTOMER_PORTAL_FEATURES },
    scoped,
  );

  return created.id;
}
