import "server-only";

import { asc, eq } from "drizzle-orm";

import { withFamily } from "./tenant";
import { family, level, organization, program, student } from "./schema";
import { readStudentProgress, type StudentLevelProgress } from "./queries";

/**
 * Lectures du portail parent.
 *
 * ── Pourquoi un module séparé ────────────────────────────────────────────────
 *
 * Les requêtes de la console sont écrites pour un membre du personnel : elles
 * lisent large parce que le personnel a le droit de tout voir de son école. Les
 * réutiliser telles quelles pour un parent marcherait — la RLS les
 * restreindrait — mais elles rapporteraient des colonnes qu'il n'a pas à voir.
 *
 * ── La RLS filtre des lignes, pas des colonnes ───────────────────────────────
 *
 * C'est la limite qu'il faut avoir en tête. Le parent a légitimement accès à la
 * **ligne** de son école : sans elle, pas de nom, pas de fuseau, pas de devise.
 * Mais cette ligne porte aussi `stripe_account_id`, `settings`, et demain
 * d'autres réglages internes. Un `select *` les lui servirait, sans qu'aucune
 * politique n'ait été violée.
 *
 * D'où la règle de ce module : **aucune étoile, jamais**. Chaque colonne est
 * nommée, et la nommer est une décision. Une colonne ajoutée à une table ne
 * peut donc pas atteindre le portail par simple effet de bord.
 */

export type PortalChild = {
  id: string;
  firstName: string;
  lastName: string;
  currentLevelName: string | null;
  currentLevelColor: string | null;
  currentProgramName: string | null;
};

export type PortalSchool = {
  name: string;
  timezone: string;
};

/**
 * L'école, réduite à ce que le portail affiche.
 *
 * Ni `stripe_account_id`, ni `settings`, ni `public_booking_enabled` : le
 * parent lit le nom de son école et le fuseau dans lequel s'expriment les
 * horaires. Rien d'autre ne le concerne.
 */
export async function getPortalSchool(
  organizationId: string,
  familyId: string,
): Promise<PortalSchool | null> {
  return withFamily(organizationId, familyId, async (tx) => {
    const [row] = await tx
      .select({ name: organization.name, timezone: organization.timezone })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);

    return row ?? null;
  });
}

/** Le nom du foyer, tel que l'école l'a saisi. */
export async function getPortalFamilyLabel(
  organizationId: string,
  familyId: string,
): Promise<string | null> {
  return withFamily(organizationId, familyId, async (tx) => {
    const [row] = await tx
      .select({ label: family.primaryGuardianName })
      .from(family)
      .where(eq(family.id, familyId))
      .limit(1);

    return row?.label ?? null;
  });
}

/**
 * Les enfants du foyer.
 *
 * Le `where` porte sur la famille, et la RLS la porte aussi. Cette redondance
 * est voulue : la première barrière rend la requête lisible, la seconde la rend
 * sûre. Retirer le `where` ne changerait rien au résultat — c'est exactement ce
 * que `parent-authz:verify` vérifie.
 *
 * `medicalNotes` n'est pas lu : le parent connaît les siennes, et le portail
 * n'a pas à les afficher tant qu'il n'a pas de quoi les modifier.
 */
export async function getPortalChildren(
  organizationId: string,
  familyId: string,
): Promise<PortalChild[]> {
  return withFamily(organizationId, familyId, async (tx) =>
    tx
      .select({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        currentLevelName: level.name,
        currentLevelColor: level.color,
        currentProgramName: program.name,
      })
      .from(student)
      .leftJoin(level, eq(level.id, student.currentLevelId))
      .leftJoin(program, eq(program.id, level.programId))
      .where(eq(student.familyId, familyId))
      .orderBy(asc(student.firstName)),
  );
}

/**
 * La progression d'un enfant, pour son mur de badges.
 *
 * Réutilise `getStudentProgress()` de la Semaine 7 sans le dupliquer : le
 * calcul des badges est le même pour tout le monde, seule la découpe d'accès
 * change. Le contexte famille est posé autour de l'appel, donc `skill_progress`
 * est filtré par la politique à sous-requête sur `student`.
 *
 * Retourne un tableau vide si l'élève n'est pas de ce foyer — pas une erreur,
 * pas un « interdit » : côté parent comme côté console, l'inexistant et
 * l'interdit se ressemblent, ce qui évite de confirmer une existence.
 */
export async function getPortalChildProgress(
  organizationId: string,
  familyId: string,
  studentId: string,
): Promise<StudentLevelProgress[]> {
  return withFamily(organizationId, familyId, async (tx) => {
    const [owned] = await tx
      .select({ id: student.id })
      .from(student)
      .where(eq(student.id, studentId))
      .limit(1);

    if (!owned) return [];

    return readStudentProgress(tx, organizationId, studentId);
  });
}
