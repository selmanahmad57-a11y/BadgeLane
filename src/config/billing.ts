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
 * Ce que l'école doit voir comme « à récupérer ».
 *
 * `open` — finalisée, échue ou non, mais pas payée. `uncollectible` — Stripe a
 * renoncé après ses relances. `draft` en est absent (rien n'a été demandé),
 * `void` aussi (la demande a été annulée), et `paid` évidemment.
 *
 * Ces statuts viennent de Stripe : nous les lisons, nous n'en décidons aucun.
 */
export const UNPAID_INVOICE_STATUSES: readonly string[] = [
  "open",
  "uncollectible",
];

/**
 * Abonnements dont le paiement ne passe plus.
 *
 * `past_due` est celui que produit un prélèvement échoué : Stripe est en train
 * de retenter (Smart Retries) et d'écrire à la famille. `unpaid` vient après,
 * quand il a cessé. `incomplete` signale un premier paiement jamais abouti.
 */
export const AT_RISK_SUBSCRIPTION_STATUSES: readonly string[] = [
  "past_due",
  "unpaid",
  "incomplete",
];

/**
 * Ce que le portail Stripe autorise au parent.
 *
 * ── Pourquoi ces deux-là et pas les autres ───────────────────────────────────
 *
 * `payment_method_update` est la raison d'être du portail : quand un
 * prélèvement échoue, c'est presque toujours une carte expirée. Le parent la
 * remplace lui-même, sans que l'école ait à manipuler un numéro de carte —
 * BadgeLane non plus, d'ailleurs.
 *
 * `invoice_history` lui donne ses factures et le moyen de payer celles qui
 * restent ouvertes.
 *
 * Tout ce qui n'est pas listé reste **désactivé** — c'est le défaut de Stripe.
 * En particulier `subscription_cancel` : résilier l'inscription d'un enfant est
 * une décision qui se prend avec l'école, pas un bouton dans un portail de
 * paiement. Le self-service côté parent arrive en Semaine 10, avec les règles
 * qui vont avec.
 */
export const CUSTOMER_PORTAL_FEATURES = {
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
} as const;

/**
 * Marque de la configuration de portail **réservée aux sessions parent**.
 *
 * ── Pourquoi une configuration à nous, et non celle de l'école ──────────────
 *
 * En Semaine 9, une session de portail déléguait à la configuration par défaut
 * du compte connecté : l'école est le marchand, ses réglages priment. C'est
 * juste pour une session qu'**elle** ouvre.
 *
 * Ça ne l'est plus pour une session **parent**. Le portail hébergé propose
 * l'annulation d'abonnement par configuration — souvent active par défaut. En
 * Temps 2a, on a délibérément refusé au parent le pouvoir de désinscrire son
 * enfant : libérer une place déclenche une promotion de liste d'attente que
 * personne n'a validée. Déléguer ici rouvrirait cette porte par un autre
 * chemin. *Un second endroit qui sait le faire est un second endroit où
 * l'oublier* — cette fois à travers la frontière Stripe.
 *
 * ── Et pourquoi une marque plutôt qu'un identifiant stocké ──────────────────
 *
 * Les configurations de portail sont **par compte connecté**. Chaque école est
 * un compte distinct : une configuration créée pour l'une n'existe pas chez
 * les autres. La marque permet de la retrouver — ou de constater son absence —
 * école par école, sans rien mémoriser de notre côté.
 */
export const PARENT_PORTAL_CONFIGURATION_MARK = "badgelane_parent_portal";

/**
 * Ce que le portail **parent** autorise, et refuse.
 *
 * `subscription_cancel` est déclaré explicitement à `false` plutôt qu'omis.
 * L'omission suffirait à la création — Stripe désactive par défaut — mais pas à
 * la remise en conformité d'une configuration existante : un champ absent ne
 * corrige rien. L'écrire rend l'intention exécutable.
 */
export const PARENT_PORTAL_FEATURES = {
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
  subscription_cancel: { enabled: false },
  subscription_update: { enabled: false },
} as const;

/**
 * Langue du portail : laissée à Stripe.
 *
 * Nous connaissons pourtant la langue de la famille. Mais la lui imposer
 * supposerait de tenir une copie de la liste des langues que Stripe sait
 * afficher — une liste qui vieillirait en silence, et qui ferait échouer
 * l'ouverture du portail le jour où l'école ajoute une langue que Stripe ne
 * connaît pas. `auto` ne peut pas se tromper d'une façon qu'on ne voit pas.
 */
export const CUSTOMER_PORTAL_LOCALE = "auto";

/**
 * Aucune commission de plateforme sur les frais de scolarité : l'école encaisse
 * l'intégralité, BadgeLane se rémunère par son abonnement SaaS.
 *
 * Exprimé comme un réglage plutôt que par une absence de code : le jour où le
 * modèle changerait, il n'y aurait qu'une valeur à poser, pas une intégration à
 * reprendre.
 */
export const PLATFORM_FEE_BASIS_POINTS = 0;
