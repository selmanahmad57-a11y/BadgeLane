import "server-only";

import { asc, eq } from "drizzle-orm";

import {
  level,
  location,
  program,
  skill,
  staffUser,
  type Level,
  type Location,
  type Program,
  type Skill,
  type StaffUser,
} from "./schema";
import { withTenant } from "./tenant";

/**
 * Lectures de la console d'administration.
 *
 * Chaque requête filtre explicitement sur `organization_id`, **en plus** de la
 * RLS. C'est la règle d'or du §3 du blueprint : « filtré en requête *et*
 * protégé par RLS ». La redondance est délibérée — l'épisode `BYPASSRLS` a
 * montré qu'une protection unique peut être neutralisée sans laisser de trace.
 */

export type CurriculumLevel = Level & { skills: Skill[] };
export type CurriculumProgram = Program & { levels: CurriculumLevel[] };

/**
 * Le curriculum complet : programmes -> niveaux -> compétences.
 *
 * Trois requêtes à plat plutôt qu'une jointure : le volume est celui d'une
 * école (quelques dizaines de lignes), et l'assemblage en mémoire évite la
 * duplication des lignes parentes qu'une jointure imposerait.
 */
export async function getCurriculum(
  organizationId: string,
): Promise<CurriculumProgram[]> {
  return withTenant(organizationId, async (tx) => {
    const [programs, levels, skills] = await Promise.all([
      tx
        .select()
        .from(program)
        .where(eq(program.organizationId, organizationId))
        .orderBy(asc(program.name)),
      tx
        .select()
        .from(level)
        .where(eq(level.organizationId, organizationId))
        .orderBy(asc(level.sortOrder)),
      tx
        .select()
        .from(skill)
        .where(eq(skill.organizationId, organizationId))
        .orderBy(asc(skill.sortOrder)),
    ]);

    const skillsByLevel = new Map<string, Skill[]>();
    for (const entry of skills) {
      const bucket = skillsByLevel.get(entry.levelId);
      if (bucket) bucket.push(entry);
      else skillsByLevel.set(entry.levelId, [entry]);
    }

    const levelsByProgram = new Map<string, CurriculumLevel[]>();
    for (const entry of levels) {
      const withSkills: CurriculumLevel = {
        ...entry,
        skills: skillsByLevel.get(entry.id) ?? [],
      };
      const bucket = levelsByProgram.get(entry.programId);
      if (bucket) bucket.push(withSkills);
      else levelsByProgram.set(entry.programId, [withSkills]);
    }

    return programs.map((entry) => ({
      ...entry,
      levels: levelsByProgram.get(entry.id) ?? [],
    }));
  });
}

export async function getLocations(
  organizationId: string,
): Promise<Location[]> {
  return withTenant(organizationId, (tx) =>
    tx
      .select()
      .from(location)
      .where(eq(location.organizationId, organizationId))
      .orderBy(asc(location.name)),
  );
}

export async function getStaffMembers(
  organizationId: string,
): Promise<StaffUser[]> {
  return withTenant(organizationId, (tx) =>
    tx
      .select()
      .from(staffUser)
      .where(eq(staffUser.organizationId, organizationId))
      .orderBy(asc(staffUser.email)),
  );
}

/**
 * Position suivante dans une liste ordonnée.
 *
 * Calculée à partir du maximum existant plutôt que du nombre d'éléments : après
 * une suppression, compter les lignes produirait une position déjà prise.
 */
export function nextSortOrder(
  existing: readonly { sortOrder: number }[],
  step: number,
): number {
  const highest = existing.reduce(
    (max, entry) => Math.max(max, entry.sortOrder),
    0,
  );
  return highest + step;
}
