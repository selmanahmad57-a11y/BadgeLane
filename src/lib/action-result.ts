/**
 * Type de retour des actions serveur d'écriture.
 *
 * Volontairement dépourvu de `server-only` et de toute logique : ce module est
 * importé par les formulaires, qui sont des composants clients. Les seules
 * valeurs qui traversent la frontière sont ces clés d'erreur — jamais un
 * message technique, jamais une trace.
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

export type ActionResult =
  | { ok: true }
  | { ok: false; errorKey: ActionErrorKey };

export const actionSucceeded: ActionResult = { ok: true };

export function actionFailed(errorKey: ActionErrorKey): ActionResult {
  return { ok: false, errorKey };
}
