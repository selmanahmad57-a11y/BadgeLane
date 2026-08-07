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
 * Rythmes de facturation proposés par une école.
 *
 * ── Deux familles, deux objets Stripe ────────────────────────────────────────
 *
 * `weekly` et `monthly` sont des **abonnements** : Stripe prélève tout seul, la
 * carte est enregistrée, et le cycle continue jusqu'à résiliation.
 *
 * `term` — facturer la session d'avance — n'est pas un abonnement à trois mois.
 * C'est un **paiement unique**, émis une fois, payé une fois. Beaucoup d'écoles
 * de natation facturent ainsi. Le construire avec un abonnement obligerait à le
 * résilier au bon moment pour qu'il ne se reconduise pas : une échéance à tenir
 * là où une facture ponctuelle n'en demande aucune.
 *
 * D'où deux chemins Stripe distincts — *Subscriptions* d'un côté, *Invoices* de
 * l'autre — et la séparation ci-dessous, qui empêche de confondre les deux au
 * moment d'appeler l'API.
 */
export const TUITION_INTERVALS = ["weekly", "monthly", "term"] as const;

export type TuitionInterval = (typeof TUITION_INTERVALS)[number];

/**
 * Correspondance vers les intervalles récurrents de Stripe.
 *
 * Volontairement **partielle** : `term` n'y figure pas, et ne peut donc pas y
 * être cherché par inadvertance. C'est le type qui interdit l'erreur — créer un
 * prix récurrent pour une facture ponctuelle produirait un abonnement fantôme
 * qui se reconduirait chaque trimestre sans que personne l'ait demandé.
 */
export const STRIPE_RECURRING_INTERVAL = {
  weekly: "week",
  monthly: "month",
} as const satisfies Partial<Record<TuitionInterval, "week" | "month">>;

/** Rythmes donnant lieu à un abonnement Stripe. */
export type RecurringTuitionInterval = keyof typeof STRIPE_RECURRING_INTERVAL;

/**
 * Distingue les deux familles à l'exécution.
 *
 * Le formulaire soumet une chaîne : c'est ici, et une seule fois, qu'elle
 * devient l'un ou l'autre chemin.
 */
export function isRecurringInterval(
  interval: TuitionInterval,
): interval is RecurringTuitionInterval {
  return interval in STRIPE_RECURRING_INTERVAL;
}

/**
 * Délai de paiement accordé sur une facture ponctuelle, en jours.
 *
 * Stripe en déduit l'échéance ; c'est elle qui déclenchera les relances de la
 * Semaine 9. Réglage global pour l'instant : il rejoindra les paramètres de
 * l'école en Semaine 12, où le trimestre et ses délais sont des décisions
 * d'établissement, pas d'instance.
 */
export const TERM_INVOICE_DAYS_UNTIL_DUE = 14;

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
