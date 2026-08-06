import "server-only";

import { ForbiddenError, assertCan, type Capability } from "@/config/permissions";

import {
  actionFailed,
  actionSucceeded,
  type ActionResult,
} from "./action-result";
import {
  UnauthenticatedError,
  requireStaffContext,
  type StaffContext,
} from "./session";

/**
 * Plomberie commune aux actions serveur d'écriture.
 *
 * Toute mutation passe par `runAuthorizedAction`. C'est le seul endroit qui
 * résout la session et vérifie le rôle : une action ne *peut pas* omettre le
 * contrôle, puisqu'elle ne reçoit son contexte qu'après.
 */

export type { ActionErrorKey, ActionResult } from "./action-result";

/** Rejet d'une saisie. Traduit par un message de formulaire, pas par une panne. */
export class ValidationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ValidationError";
  }
}

/**
 * Exécute `run` avec le contexte du membre connecté, après avoir vérifié qu'il
 * détient `capability`.
 *
 * Les erreurs attendues deviennent un résultat affichable ; les autres sont
 * relancées, pour rester visibles dans Sentry plutôt que d'être avalées en un
 * « une erreur est survenue » silencieux.
 */
export async function runAuthorizedAction(
  capability: Capability,
  run: (context: StaffContext) => Promise<void>,
): Promise<ActionResult> {
  let context: StaffContext;

  try {
    context = await requireStaffContext();
    assertCan(context.role, capability);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return actionFailed("unauthenticated");
    }
    if (error instanceof ForbiddenError) {
      return actionFailed("forbidden");
    }
    throw error;
  }

  try {
    await run(context);
    return actionSucceeded;
  } catch (error) {
    if (error instanceof ValidationError) {
      return actionFailed("invalid");
    }
    throw error;
  }
}

/**
 * Lit un champ texte obligatoire d'un formulaire.
 *
 * Les données de formulaire arrivent du navigateur : rien n'y est digne de
 * confiance, ni le type, ni la présence, ni la longueur.
 */
export function requiredText(
  formData: FormData,
  field: string,
  maxLength: number,
): string {
  const raw = formData.get(field);

  if (typeof raw !== "string") {
    throw new ValidationError(`Champ « ${field} » absent.`);
  }

  const value = raw.trim();

  if (value.length === 0) {
    throw new ValidationError(`Champ « ${field} » vide.`);
  }

  if (value.length > maxLength) {
    throw new ValidationError(
      `Champ « ${field} » trop long (${value.length} > ${maxLength}).`,
    );
  }

  return value;
}

/** Variante facultative : une chaîne vide devient `null`, pas `""`. */
export function optionalText(
  formData: FormData,
  field: string,
  maxLength: number,
): string | null {
  const raw = formData.get(field);

  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (value.length === 0) return null;

  if (value.length > maxLength) {
    throw new ValidationError(
      `Champ « ${field} » trop long (${value.length} > ${maxLength}).`,
    );
  }

  return value;
}

/** Identifiant attendu au format UUID, tel que produit par la base. */
export function requiredUuid(formData: FormData, field: string): string {
  const raw = formData.get(field);

  if (
    typeof raw !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    throw new ValidationError(`Identifiant « ${field} » invalide.`);
  }

  return raw;
}

/** Valeur contrainte à un ensemble fermé, ex. un rôle. */
export function requiredEnum<T extends string>(
  formData: FormData,
  field: string,
  allowed: readonly T[],
): T {
  const raw = formData.get(field);

  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    throw new ValidationError(`Valeur « ${field} » hors des choix autorisés.`);
  }

  return raw as T;
}
