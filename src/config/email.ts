/**
 * Vocabulaire des envois sortants.
 *
 * ── Pourquoi une clé composite, et non un identifiant technique ─────────────
 *
 * L'unicité d'un envoi n'est pas « cette ligne » mais « cet e-mail-là » :
 * quelle nature, à propos de quoi, pour quelle période. Un identifiant
 * autogénéré n'empêcherait rien — c'est la clé métier qui rend le doublon
 * impossible plutôt que détecté. Même raisonnement que l'identifiant
 * d'événement Stripe en clé primaire.
 */
export const EMAIL_KINDS = [
  /** Confirmation de paiement, déclenchée par le webhook `invoice.paid`. */
  "payment_confirmation",
  /** Rapport de progression mensuel. */
  "monthly_progress",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

/**
 * États d'un envoi.
 *
 * `claimed` existe parce que l'action irréversible vit **dehors**. Une
 * transaction Postgres ne peut pas envelopper un appel HTTP : on réclame
 * d'abord — et l'on valide —, puis on envoie. Un envoi resté `claimed` est un
 * envoi dont on ignore l'issue, et c'est une information, pas un trou.
 *
 * ── `accepted`, et surtout pas `sent` ───────────────────────────────────────
 *
 * Le fournisseur répond 200 pour dire « accepté pour livraison », jamais
 * « livré ». La preuve : un reçu a été marqué `sent` vers une adresse en
 * `.invalid` — Resend l'avait accepté, et rien n'est jamais arrivé.
 *
 * Un statut ne doit affirmer que ce qu'il a observé. C'est la même distinction
 * qu'entre le retour du navigateur et la confirmation de paiement : l'un dit
 * « le parent est revenu », l'autre « la banque a confirmé ».
 *
 * `delivered` et `bounced` existent, mais ils ne viennent pas de la réponse
 * d'envoi — ils viennent des webhooks de livraison du fournisseur, exactement
 * comme l'état d'un paiement vient des webhooks Stripe. Ils arriveront quand la
 * délivrabilité comptera, pas avant.
 */
export const EMAIL_DELIVERY_STATUSES = [
  "claimed",
  "accepted",
  "failed",
] as const;

export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
