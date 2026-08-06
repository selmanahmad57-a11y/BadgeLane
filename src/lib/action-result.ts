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
