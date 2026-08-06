import "server-only";

import { isSupportedLocale } from "@/config/i18n";
import { ForbiddenError, assertCan, type Capability } from "@/config/permissions";
import { STUDENT_AGE_BOUNDS } from "@/config/validation";
import { CrossTenantReferenceError } from "@/db/tenant-guard";

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

    /**
     * Une référence vers une autre école est traitée comme une saisie
     * invalide, et non comme un refus explicite : répondre « interdit »
     * confirmerait à qui sonde des identifiants que la ligne existe ailleurs.
     */
    if (error instanceof CrossTenantReferenceError) {
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

/**
 * Identifiant UUID facultatif : une chaîne vide devient `null`.
 *
 * Utilisé par les sélecteurs dont l'option « aucun » vaut la chaîne vide —
 * le niveau d'un élève, par exemple, tant qu'il n'en a pas été assigné.
 */
export function optionalUuid(formData: FormData, field: string): string | null {
  const raw = formData.get(field);

  if (typeof raw !== "string" || raw.trim() === "") return null;

  return requiredUuid(formData, field);
}

/**
 * Langue préférée, validée contre les langues réellement activées.
 *
 * Volontairement contrôlée ici plutôt que par un type Postgres : activer une
 * langue reste une variable d'environnement, sans migration de base (§2 du
 * blueprint).
 */
export function requiredLocale(formData: FormData, field: string): string {
  const raw = formData.get(field);

  if (typeof raw !== "string" || !isSupportedLocale(raw)) {
    throw new ValidationError(`Langue « ${String(raw)} » non activée.`);
  }

  return raw;
}

/**
 * Date au format ISO `AAAA-MM-JJ`, telle que produite par `input[type=date]`.
 *
 * Les bornes d'âge ne servent qu'à rattraper une faute de frappe sur l'année —
 * une naissance en 1025 ou en 2925 n'est pas une donnée, c'est une erreur de
 * saisie.
 */
export function requiredBirthDate(formData: FormData, field: string): string {
  const raw = formData.get(field);

  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ValidationError(`Date « ${field} » absente ou mal formée.`);
  }

  const parsed = new Date(`${raw}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Date « ${raw} » inexistante.`);
  }

  const ageInYears =
    (Date.now() - parsed.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);

  if (
    ageInYears < STUDENT_AGE_BOUNDS.minimum ||
    ageInYears > STUDENT_AGE_BOUNDS.maximum
  ) {
    throw new ValidationError(`Date de naissance « ${raw} » invraisemblable.`);
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
