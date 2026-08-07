/**
 * Vocabulaire de la facturation.
 *
 * ── Une règle qui gouverne tout ce module ────────────────────────────────────
 *
 * **Stripe détient la vérité, notre base en est le miroir.** Rien de ce qui
 * décrit un paiement n'est décidé ici : les statuts sont ceux de Stripe, et
 * nous les recopions.
 */

/**
 * Rythmes de prélèvement récurrent.
 *
 * `term` — facturer la session d'avance — est volontairement absent : ce n'est
 * pas un abonnement mais une facture ponctuelle, un autre objet et un autre
 * flux chez Stripe. Prévu en Semaine 9, via les *Invoices*. Même discipline que
 * `makeup` reporté en Semaine 10 : on n'ajoute pas une valeur que rien ne sait
 * produire.
 */
export const TUITION_INTERVALS = ["weekly", "monthly"] as const;

export type TuitionInterval = (typeof TUITION_INTERVALS)[number];

/** Correspondance vers les intervalles récurrents de Stripe. */
export const STRIPE_RECURRING_INTERVAL: Readonly<
  Record<TuitionInterval, "week" | "month">
> = {
  weekly: "week",
  monthly: "month",
};

/**
 * Statuts d'abonnement et de facture : stockés en `text`, jamais en enum.
 *
 * Ce sont des valeurs de Stripe, pas les nôtres. Les figer dans un type
 * Postgres imposerait une migration le jour où Stripe en ajoute une — et nous
 * ferions échouer l'écriture d'un miroir plutôt que de refléter la réalité.
 * Même raisonnement que pour `preferred_language`.
 *
 * Ces listes servent uniquement à l'affichage : une valeur inconnue est
 * montrée telle quelle plutôt que masquée.
 */
export const KNOWN_SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

export const KNOWN_INVOICE_STATUSES = [
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
] as const;

/**
 * Aucune commission de plateforme sur les frais de scolarité : l'école encaisse
 * l'intégralité, BadgeLane se rémunère par son abonnement SaaS.
 *
 * Exprimé comme un réglage plutôt que par une absence de code : le jour où le
 * modèle changerait, il n'y aurait qu'une valeur à poser, pas une intégration à
 * reprendre.
 */
export const PLATFORM_FEE_BASIS_POINTS = 0;
