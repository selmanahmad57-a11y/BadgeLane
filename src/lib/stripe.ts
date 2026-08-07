import "server-only";

import Stripe from "stripe";

import { isStripeConfigured, stripeEnv } from "@/config/env.stripe";

/**
 * Client Stripe de la plateforme.
 *
 * ── Connect Standard : l'école est le marchand ───────────────────────────────
 *
 * Les frais de scolarité vont directement au compte Stripe de l'école. BadgeLane
 * ne touche ni les cartes, ni les fonds — et se trouve donc hors du périmètre
 * PCI, hors responsabilité de remboursement et hors du gros du risque juridique
 * (§6 du blueprint).
 *
 * Concrètement, toute opération portant sur les données d'une école s'exécute
 * **au nom de son compte connecté**, via `stripeAccount`. Une requête sans cet
 * en-tête agirait sur le compte de la plateforme : ce serait une confusion de
 * tenant, aussi grave qu'une requête SQL sans contexte.
 */

let client: Stripe | null = null;

/** `null` si aucune clé n'est configurée — l'appelant doit le prévoir. */
export function getStripe(): Stripe | null {
  if (!isStripeConfigured) return null;

  client ??= new Stripe(stripeEnv.STRIPE_SECRET_KEY!, {
    /**
     * Identifie BadgeLane dans les journaux Stripe : indispensable le jour où
     * il faut comprendre l'origine d'un appel depuis leur tableau de bord.
     */
    appInfo: { name: "BadgeLane" },
  });

  return client;
}

/**
 * Options à joindre à toute opération concernant une école.
 *
 * Isolé dans une fonction plutôt que recopié : oublier `stripeAccount` sur un
 * seul appel suffirait à écrire dans le mauvais compte.
 */
export function forConnectedAccount(stripeAccountId: string) {
  return { stripeAccount: stripeAccountId };
}
