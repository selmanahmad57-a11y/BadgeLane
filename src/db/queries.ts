import "server-only";

import { and, asc, count, eq, ilike, or } from "drizzle-orm";

import {
  family,
  guardian,
  level,
  location,
  program,
  skill,
  staffUser,
  student,
  type Family,
  type Guardian,
  type Level,
  type Location,
  type Program,
  type Skill,
  type StaffUser,
  type Student,
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

export type FamilyWithCounts = Family & {
  guardianCount: number;
  studentCount: number;
};

/**
 * Familles de l'école, filtrées par une recherche libre.
 *
 * La recherche porte sur le nom du contact principal et sur l'adresse e-mail —
 * les deux clés par lesquelles une école retrouve un foyer au téléphone.
 * `ilike` reste suffisant à l'échelle d'une école ; un index de recherche
 * plein texte serait prématuré ici.
 */
export async function searchFamilies(
  organizationId: string,
  query: string,
): Promise<FamilyWithCounts[]> {
  const trimmed = query.trim();

  return withTenant(organizationId, async (tx) => {
    const matches = trimmed
      ? or(
          ilike(family.primaryGuardianName, `%${trimmed}%`),
          ilike(family.email, `%${trimmed}%`),
        )
      : undefined;

    const families = await tx
      .select()
      .from(family)
      .where(and(eq(family.organizationId, organizationId), matches))
      .orderBy(asc(family.primaryGuardianName));

    if (families.length === 0) return [];

    /**
     * Les effectifs sont comptés en deux requêtes groupées plutôt qu'en une
     * par famille : le nombre de requêtes reste constant quel que soit le
     * nombre de foyers affichés.
     */
    const [guardianCounts, studentCounts] = await Promise.all([
      tx
        .select({ familyId: guardian.familyId, total: count() })
        .from(guardian)
        .where(eq(guardian.organizationId, organizationId))
        .groupBy(guardian.familyId),
      tx
        .select({ familyId: student.familyId, total: count() })
        .from(student)
        .where(eq(student.organizationId, organizationId))
        .groupBy(student.familyId),
    ]);

    const guardiansByFamily = new Map(
      guardianCounts.map((row) => [row.familyId, row.total]),
    );
    const studentsByFamily = new Map(
      studentCounts.map((row) => [row.familyId, row.total]),
    );

    return families.map((entry) => ({
      ...entry,
      guardianCount: guardiansByFamily.get(entry.id) ?? 0,
      studentCount: studentsByFamily.get(entry.id) ?? 0,
    }));
  });
}

export type FamilyDetail = Family & {
  guardians: Guardian[];
  students: Student[];
};

/** Fiche famille complète : tuteurs et élèves. `null` si absente de l'école. */
export async function getFamilyDetail(
  organizationId: string,
  familyId: string,
): Promise<FamilyDetail | null> {
  return withTenant(organizationId, async (tx) => {
    const [record] = await tx
      .select()
      .from(family)
      .where(
        and(eq(family.id, familyId), eq(family.organizationId, organizationId)),
      )
      .limit(1);

    if (!record) return null;

    const [guardians, students] = await Promise.all([
      tx
        .select()
        .from(guardian)
        .where(
          and(
            eq(guardian.familyId, familyId),
            eq(guardian.organizationId, organizationId),
          ),
        )
        .orderBy(asc(guardian.name)),
      tx
        .select()
        .from(student)
        .where(
          and(
            eq(student.familyId, familyId),
            eq(student.organizationId, organizationId),
          ),
        )
        .orderBy(asc(student.firstName)),
    ]);

    return { ...record, guardians, students };
  });
}

export type StudentDetail = Student & { family: Family };

/** Fiche élève. `null` si l'élève n'appartient pas à l'école courante. */
export async function getStudentDetail(
  organizationId: string,
  studentId: string,
): Promise<StudentDetail | null> {
  return withTenant(organizationId, async (tx) => {
    const [row] = await tx
      .select({ student, family })
      .from(student)
      .innerJoin(family, eq(family.id, student.familyId))
      .where(
        and(
          eq(student.id, studentId),
          eq(student.organizationId, organizationId),
        ),
      )
      .limit(1);

    return row ? { ...row.student, family: row.family } : null;
  });
}

export type LevelOption = {
  id: string;
  name: string;
  color: string;
  programName: string;
};

/**
 * Niveaux proposés au sélecteur de la fiche élève, préfixés de leur programme —
 * deux programmes peuvent nommer un niveau de la même façon.
 */
export async function getLevelOptions(
  organizationId: string,
): Promise<LevelOption[]> {
  return withTenant(organizationId, (tx) =>
    tx
      .select({
        id: level.id,
        name: level.name,
        color: level.color,
        programName: program.name,
      })
      .from(level)
      .innerJoin(program, eq(program.id, level.programId))
      .where(eq(level.organizationId, organizationId))
      .orderBy(asc(program.name), asc(level.sortOrder)),
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
