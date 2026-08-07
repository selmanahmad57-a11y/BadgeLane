/**
 * Type de retour des actions serveur d'écriture.
 *
 * Volontairement dépourvu de `server-only` et de toute logique : ce module est
 * importé par les formulaires, qui sont des composants clients. Les seules
 * valeurs qui traversent la frontière sont des clés — jamais un message
 * technique, jamais une trace.
 */

export type ActionErrorKey =
  /** Session absente ou membre inactif. */
  | "unauthenticated"
  /** Session valide, mais rôle insuffisant. */
  | "forbidden"
  /** Données du formulaire rejetées. */
  | "invalid"
  /** Toute autre défaillance. */
  | "unexpected";

/**
 * Motifs de refus **métier**, à distinguer d'une saisie malformée.
 *
 * Une classe pleine n'est pas un champ mal rempli : répondre « vérifie les
 * champs » à quelqu'un qui vient de cliquer « donner une place » n'a aucun
 * sens — il n'y a pas de champ. Chaque motif reçoit donc son propre message,
 * qui dit ce qui s'est passé et ce qu'il faut faire.
 *
 * Les erreurs de format, elles, gardent le message générique : elles ne
 * surviennent qu'en contournant la validation du navigateur.
 */
export const ACTION_REASONS = [
  /** Le cours est complet. */
  "classFull",
  /** L'élève a déjà une inscription en cours sur ce cours. */
  "alreadyEnrolled",
  /** L'inscription visée n'est pas en liste d'attente. */
  "notWaitlisted",
  /** La ligne visée n'appartient pas à cette école, ou n'existe plus. */
  "notInThisSchool",
  /** Dates de session incohérentes. */
  "termDatesReversed",
  /** L'instructeur choisi n'est pas un membre actif. */
  "instructorNotActive",
  /** Programme, niveau ou lieu encore utilisé par des cours. */
  "programInUse",
  "levelInUse",
  "locationInUse",
  /** Retirer ce rôle laisserait l'école sans propriétaire. */
  "lastOwner",
  /** Un membre ne peut pas modifier son propre accès. */
  "cannotEditSelf",
  /** Adresse e-mail rejetée. */
  "emailInvalid",
  /** Clerk a refusé l'invitation (déjà invité, ou déjà membre). */
  "invitationRejected",
  /** La session produirait trop de séances. */
  "tooManyOccurrences",
  /** Aucune clé Stripe sur cette instance. */
  "stripeNotConfigured",
  /** L'école n'a pas encore connecté son compte Stripe. */
  "stripeNotConnected",
  /**
   * Les deux sens d'une même confusion : un tarif au trimestre se facture à
   * l'unité et ne peut pas être abonné ; un tarif hebdomadaire ou mensuel est
   * un abonnement et ne s'émet pas en facture ponctuelle.
   *
   * Deux motifs plutôt qu'un seul « mauvais tarif » : celui qui se trompe doit
   * lire ce qu'il faut faire, pas seulement qu'il s'est trompé.
   */
  "planIsOneOff",
  "planIsRecurring",
  /** La famille n'a pas d'adresse e-mail : Stripe ne peut pas lui écrire. */
  "familyHasNoEmail",
  /**
   * Aucun paiement n'a encore été demandé à cette famille : elle n'a donc pas
   * de dossier chez Stripe, et son portail serait vide. Refuser vaut mieux que
   * lui ouvrir une page sans rien dedans.
   */
  "familyNotBilledYet",
] as const;

export type ActionReason = (typeof ACTION_REASONS)[number];

/** Valeurs interpolées dans le message, ex. l'effectif et la capacité. */
export type ActionReasonValues = Record<string, string | number>;

export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      errorKey: ActionErrorKey;
      /** Présent pour un refus métier ; absent pour une saisie malformée. */
      reason?: ActionReason;
      reasonValues?: ActionReasonValues;
    };

export const actionSucceeded: ActionResult = { ok: true };

export function actionFailed(
  errorKey: ActionErrorKey,
  reason?: ActionReason,
  reasonValues?: ActionReasonValues,
): ActionResult {
  return { ok: false, errorKey, reason, reasonValues };
}
