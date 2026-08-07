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

/**
 * Forme d'un compte connecté, exprimée une seule fois.
 *
 * ── Pourquoi la v2 et non la v1 ──────────────────────────────────────────────
 *
 * Stripe refuse désormais `POST /v1/accounts` pour les nouvelles intégrations
 * et impose `POST /v2/core/accounts`. Découvert en appelant l'API, pas en la
 * lisant — la v1 compilait parfaitement et aurait échoué en production.
 *
 * ── Ce que ces trois réglages disent ─────────────────────────────────────────
 *
 * La v1 résumait tout par le mot « standard ». La v2 demande de l'énoncer :
 *
 *  - `dashboard: "full"` — l'école dispose de son propre tableau de bord
 *    Stripe, comme un marchand ordinaire ;
 *  - `losses_collector: "stripe"` — les impayés et litiges sont supportés par
 *    l'école, pas par la plateforme ;
 *  - `fees_collector: "stripe"` — les frais Stripe sont prélevés sur elle.
 *
 * C'est exactement le modèle du §6 du blueprint : l'école est le marchand,
 * BadgeLane ne touche ni les cartes ni les fonds, et se trouve hors PCI et hors
 * responsabilité de remboursement. Ces trois lignes en sont l'expression
 * technique — et le fait qu'elles soient explicites vaut mieux qu'un mot-clé
 * dont il faut deviner les implications.
 */
export function connectedAccountConfiguration(
  countryIsoAlpha2: string,
): Omit<Stripe.V2.Core.AccountCreateParams, "metadata"> {
  return {
    include: ["configuration.merchant", "requirements", "identity"],
    dashboard: "full" as const,
    /** La v2 attend le code pays en minuscules ; notre base le stocke en ISO majuscule. */
    identity: { country: countryIsoAlpha2.toLowerCase() },
    defaults: {
      responsibilities: {
        losses_collector: "stripe" as const,
        fees_collector: "stripe" as const,
      },
    },
    configuration: { merchant: {} },
  };
}
