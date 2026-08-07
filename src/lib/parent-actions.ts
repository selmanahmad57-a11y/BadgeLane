import "server-only";

import type { ParentCapability } from "@/config/access";
import type { TenantTransaction } from "@/db/tenant";
import { withFamily } from "@/db/tenant";

import {
  actionFailed,
  actionSucceeded,
  type ActionResult,
} from "./action-result";
import { ValidationError } from "./actions";
import { CrossTenantReferenceError } from "@/db/tenant-guard";
import { requireParentMemberships, type ParentMembership } from "./parent-auth";
import type { Locale } from "@/config/i18n";

/**
 * Exécuteur des écritures parent — miroir de `runAuthorizedAction`.
 *
 * ── Pourquoi un second exécuteur, et non un paramètre du premier ─────────────
 *
 * Parce que les deux sujets n'ont rien en commun. Le personnel tient sa
 * légitimité d'une appartenance à une Organisation Clerk et d'un rôle ; le
 * parent la tient d'une adresse e-mail vérifiée et d'un foyer. Fusionner les
 * deux chemins reviendrait à écrire un `if` au milieu de la garde — et une
 * garde qui bifurque est une garde qu'on finit par prendre par le mauvais
 * côté.
 *
 * Ici, `ParentCapability` et `Capability` sont deux types disjoints. Passer
 * l'une là où l'autre est attendue ne compile pas.
 *
 * ── Les trois barrières, dans l'ordre ────────────────────────────────────────
 *
 * 1. L'adresse vérifiée décide des foyers accessibles — jamais le formulaire.
 * 2. Le foyer soumis doit figurer parmi eux, sinon rien ne s'ouvre.
 * 3. `withFamily()` pose le contexte, et la RLS refuse tout ce qui dépasse,
 *    y compris à l'écriture (`with check`).
 *
 * La troisième rend les deux premières redondantes. C'est voulu : le jour où un
 * remaniement casse la garde applicative, la base tient encore.
 */

export type ParentContext = ParentMembership & { locale: Locale };

/**
 * Refus renvoyé quand le foyer soumis n'appartient pas au visiteur.
 *
 * Il ne se distingue pas d'un foyer inexistant — même discipline que le 404 de
 * la fiche enfant : répondre « interdit » confirmerait qu'il existe.
 */
export class UnknownFamilyError extends Error {
  constructor(readonly familyId: string) {
    super(`Aucun foyer accessible sous l'identifiant ${familyId}.`);
    this.name = "UnknownFamilyError";
  }
}

export async function runParentAction(
  locale: Locale,
  capability: ParentCapability,
  familyId: string,
  run: (context: ParentContext, tx: TenantTransaction) => Promise<void>,
): Promise<ActionResult> {
  /**
   * `capability` n'est pas encore consultée : le portail n'expose qu'une seule
   * écriture, et tout parent rattaché la détient. Elle est exigée dès
   * maintenant pour que l'ajout d'une seconde capacité — réserver un
   * rattrapage, en Temps 3 — soit un ajout de table, pas une reprise de toutes
   * les actions déjà écrites.
   */
  void capability;

  const memberships = await requireParentMemberships(locale);
  const membership = memberships.find((entry) => entry.familyId === familyId);

  if (!membership) {
    return actionFailed("invalid", "notInThisSchool");
  }

  try {
    await withFamily(membership.organizationId, membership.familyId, (tx) =>
      run({ ...membership, locale }, tx),
    );

    return actionSucceeded;
  } catch (error) {
    if (error instanceof ValidationError) {
      return actionFailed("invalid", error.reason, error.reasonValues);
    }

    /**
     * Une référence vers une autre école — ou un autre foyer — est présentée
     * comme introuvable, jamais comme interdite.
     */
    if (
      error instanceof CrossTenantReferenceError ||
      error instanceof UnknownFamilyError
    ) {
      return actionFailed("invalid", "notInThisSchool");
    }

    throw error;
  }
}
