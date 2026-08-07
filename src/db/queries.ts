import "server-only";

import { alias } from "drizzle-orm/pg-core";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { AttendanceStatus } from "@/config/attendance";
import type { ProgressStatus } from "@/config/progress";
import type { LevelWithSkills } from "@/lib/badges";
import {
  LIVE_ENROLLMENT_STATUSES,
  type EnrollmentStatus,
} from "@/config/enrollment";

import { WAITLIST_RANK } from "./enrollment";
import { rosterWindowCondition } from "./roster";
import {
  attendance,
  classOccurrence,
  enrollment,
  family,
  guardian,
  klass,
  level,
  location,
  program,
  skill,
  skillProgress,
  staffUser,
  student,
  invoice,
  subscription,
  term,
  tuitionPlan,
  type ClassOccurrence,
  type Family,
  type Guardian,
  type Klass,
  type Level,
  type Location,
  type Program,
  type Skill,
  type StaffUser,
  type Student,
  type Term,
  type TuitionPlan,
} from "./schema";
import { withTenant, type TenantTransaction } from "./tenant";

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

export type TermRecord = Term & { klassCount: number };

export async function getTerms(organizationId: string): Promise<TermRecord[]> {
  return withTenant(organizationId, async (tx) => {
    const [terms, counts] = await Promise.all([
      tx
        .select()
        .from(term)
        .where(eq(term.organizationId, organizationId))
        .orderBy(desc(term.startDate)),
      tx
        .select({ termId: klass.termId, total: count() })
        .from(klass)
        .where(eq(klass.organizationId, organizationId))
        .groupBy(klass.termId),
    ]);

    const byTerm = new Map(counts.map((row) => [row.termId, row.total]));

    return terms.map((entry) => ({
      ...entry,
      klassCount: byTerm.get(entry.id) ?? 0,
    }));
  });
}

export type ScheduledClass = Klass & {
  programName: string;
  levelName: string;
  levelColor: string;
  locationName: string;
  instructorName: string | null;
  termName: string;
  occurrenceCount: number;
};

/**
 * Classes d'une session, enrichies de tout ce que la grille affiche.
 *
 * Une seule requête jointe plutôt qu'un aller-retour par classe : la grille
 * montre l'ensemble de la semaine d'un coup.
 */
export async function getScheduledClasses(
  organizationId: string,
  termId: string,
): Promise<ScheduledClass[]> {
  return withTenant(organizationId, async (tx) => {
    const rows = await tx
      .select({
        klass,
        programName: program.name,
        levelName: level.name,
        levelColor: level.color,
        locationName: location.name,
        instructorName: staffUser.fullName,
        instructorEmail: staffUser.email,
        termName: term.name,
      })
      .from(klass)
      .innerJoin(program, eq(program.id, klass.programId))
      .innerJoin(level, eq(level.id, klass.levelId))
      .innerJoin(location, eq(location.id, klass.locationId))
      .innerJoin(term, eq(term.id, klass.termId))
      .leftJoin(staffUser, eq(staffUser.id, klass.instructorId))
      .where(
        and(eq(klass.organizationId, organizationId), eq(klass.termId, termId)),
      )
      .orderBy(asc(klass.dayOfWeek), asc(klass.startTime));

    if (rows.length === 0) return [];

    const counts = await tx
      .select({ klassId: classOccurrence.klassId, total: count() })
      .from(classOccurrence)
      .where(eq(classOccurrence.organizationId, organizationId))
      .groupBy(classOccurrence.klassId);

    const byKlass = new Map(counts.map((row) => [row.klassId, row.total]));

    return rows.map((row) => ({
      ...row.klass,
      programName: row.programName,
      levelName: row.levelName,
      levelColor: row.levelColor,
      locationName: row.locationName,
      /** Un coach sans nom renseigné reste identifiable par son adresse. */
      instructorName: row.instructorName ?? row.instructorEmail ?? null,
      termName: row.termName,
      occurrenceCount: byKlass.get(row.klass.id) ?? 0,
    }));
  });
}

export async function getOccurrences(
  organizationId: string,
  klassId: string,
): Promise<ClassOccurrence[]> {
  return withTenant(organizationId, (tx) =>
    tx
      .select()
      .from(classOccurrence)
      .where(
        and(
          eq(classOccurrence.organizationId, organizationId),
          eq(classOccurrence.klassId, klassId),
        ),
      )
      .orderBy(asc(classOccurrence.date)),
  );
}

/** Membres pouvant encadrer un cours : tout membre actif de l'école. */
export async function getInstructorOptions(
  organizationId: string,
): Promise<{ id: string; label: string }[]> {
  return withTenant(organizationId, async (tx) => {
    const rows = await tx
      .select({
        id: staffUser.id,
        fullName: staffUser.fullName,
        email: staffUser.email,
      })
      .from(staffUser)
      .where(
        and(
          eq(staffUser.organizationId, organizationId),
          eq(staffUser.active, true),
        ),
      )
      .orderBy(asc(staffUser.email));

    return rows.map((row) => ({ id: row.id, label: row.fullName ?? row.email }));
  });
}

export async function getLocationOptions(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return withTenant(organizationId, (tx) =>
    tx
      .select({ id: location.id, name: location.name })
      .from(location)
      .where(eq(location.organizationId, organizationId))
      .orderBy(asc(location.name)),
  );
}

/**
 * Nombre de cours référençant une ressource du curriculum ou un lieu.
 *
 * Les clés étrangères du planning sont en `ON DELETE restrict` : supprimer un
 * niveau encore programmé échouerait par violation de contrainte, message
 * illisible à l'appui. Ce compte permet de refuser proprement, avec une
 * explication.
 */
export async function countClassesUsing(
  organizationId: string,
  reference:
    | { programId: string }
    | { levelId: string }
    | { locationId: string },
): Promise<number> {
  return withTenant(organizationId, async (tx) => {
    const condition =
      "programId" in reference
        ? eq(klass.programId, reference.programId)
        : "levelId" in reference
          ? eq(klass.levelId, reference.levelId)
          : eq(klass.locationId, reference.locationId);

    const [row] = await tx
      .select({ total: count() })
      .from(klass)
      .where(and(eq(klass.organizationId, organizationId), condition));

    return row?.total ?? 0;
  });
}

export type RosterEntry = {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  status: EnrollmentStatus;
  startDate: string | null;
  familyId: string;
};

export type WaitlistEntry = RosterEntry & { rank: number };

export type ClassEnrolment = {
  capacity: number;
  roster: RosterEntry[];
  waitlist: WaitlistEntry[];
};

/**
 * Effectif et file d'attente d'un cours.
 *
 * Le rang n'est pas lu : il est calculé par `row_number()` sur la même clé de
 * tri que le module d'inscription. Promouvoir le premier fait donc remonter
 * tous les suivants sans qu'aucune ligne ne soit réécrite.
 */
export async function getClassEnrolment(
  organizationId: string,
  klassId: string,
): Promise<ClassEnrolment> {
  return withTenant(organizationId, async (tx) => {
    const [target] = await tx
      .select({ capacity: klass.capacity })
      .from(klass)
      .where(
        and(eq(klass.id, klassId), eq(klass.organizationId, organizationId)),
      )
      .limit(1);

    if (!target) return { capacity: 0, roster: [], waitlist: [] };

    const rows = await tx
      .select({
        enrollmentId: enrollment.id,
        studentId: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        familyId: student.familyId,
        status: enrollment.status,
        startDate: enrollment.startDate,
        rank: WAITLIST_RANK,
      })
      .from(enrollment)
      .innerJoin(student, eq(student.id, enrollment.studentId))
      .where(
        and(
          eq(enrollment.organizationId, organizationId),
          eq(enrollment.klassId, klassId),
          inArray(enrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        ),
      )
      .orderBy(asc(enrollment.status), asc(student.firstName));

    const toEntry = (row: (typeof rows)[number]): RosterEntry => ({
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      studentName: `${row.firstName} ${row.lastName}`,
      status: row.status,
      startDate: row.startDate,
      familyId: row.familyId,
    });

    return {
      capacity: target.capacity,
      roster: rows
        .filter((row) => row.status !== "waitlisted")
        .map(toEntry),
      /**
       * Le rang renvoyé par `row_number()` porte sur l'ensemble de la partition,
       * inscrits compris ; il est donc recalculé sur la seule file, après filtre.
       */
      waitlist: rows
        .filter((row) => row.status === "waitlisted")
        .map((row, index) => ({ ...toEntry(row), rank: index + 1 })),
    };
  });
}

/** Élèves de l'école n'ayant pas déjà une inscription vivante à ce cours. */
export async function getEnrollableStudents(
  organizationId: string,
  klassId: string,
): Promise<{ id: string; label: string }[]> {
  return withTenant(organizationId, async (tx) => {
    const taken = tx
      .select({ studentId: enrollment.studentId })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.organizationId, organizationId),
          eq(enrollment.klassId, klassId),
          inArray(enrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        ),
      );

    const rows = await tx
      .select({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
      })
      .from(student)
      .where(
        and(
          eq(student.organizationId, organizationId),
          notInArray(student.id, taken),
        ),
      )
      .orderBy(asc(student.firstName), asc(student.lastName));

    return rows.map((row) => ({
      id: row.id,
      label: `${row.firstName} ${row.lastName}`,
    }));
  });
}

export type StudentEnrolment = {
  enrollmentId: string;
  klassId: string;
  klassTitle: string;
  levelName: string;
  status: EnrollmentStatus;
  startDate: string | null;
  endDate: string | null;
};

/** Inscriptions d'un élève, historique compris. */
export async function getStudentEnrolments(
  organizationId: string,
  studentId: string,
): Promise<StudentEnrolment[]> {
  return withTenant(organizationId, (tx) =>
    tx
      .select({
        enrollmentId: enrollment.id,
        klassId: klass.id,
        klassTitle: klass.title,
        levelName: level.name,
        status: enrollment.status,
        startDate: enrollment.startDate,
        endDate: enrollment.endDate,
      })
      .from(enrollment)
      .innerJoin(klass, eq(klass.id, enrollment.klassId))
      .innerJoin(level, eq(level.id, klass.levelId))
      .where(
        and(
          eq(enrollment.organizationId, organizationId),
          eq(enrollment.studentId, studentId),
        ),
      )
      .orderBy(asc(enrollment.status), asc(klass.title)),
  );
}

export type AttendanceRosterEntry = {
  studentId: string;
  studentName: string;
  medicalNotes: string | null;
  status: AttendanceStatus | null;
};

export type CoachSession = {
  occurrenceId: string;
  klassId: string;
  title: string;
  startTime: string;
  durationMin: number;
  levelName: string;
  levelColor: string;
  locationName: string;
  instructorId: string | null;
  roster: AttendanceRosterEntry[];
};

/**
 * Séances du jour, avec leur feuille de présence.
 *
 * ── La feuille est datée, pas « actuelle » ───────────────────────────────────
 *
 * Le roster d'une séance est la liste des élèves **inscrits à cette date-là**,
 * pas des élèves inscrits aujourd'hui. La différence compte dès qu'on rattrape
 * un appel oublié : un enfant parti depuis doit figurer sur la feuille de la
 * semaine dernière, et un enfant arrivé lundi ne doit pas apparaître sur celle
 * de la semaine précédente.
 *
 * D'où le filtre sur la fenêtre `[start_date, end_date]` de l'inscription
 * plutôt que sur son statut courant. Les inscriptions en liste d'attente sont
 * exclues : elles n'ont jamais commencé.
 *
 * Les séances annulées n'apparaissent pas — une séance qui n'a pas eu lieu n'a
 * pas de présence à relever.
 */
export async function getSessionsForDate(
  organizationId: string,
  date: string,
): Promise<CoachSession[]> {
  return withTenant(organizationId, async (tx) => {
    const sessions = await tx
      .select({
        occurrenceId: classOccurrence.id,
        klassId: klass.id,
        title: klass.title,
        startTime: klass.startTime,
        durationMin: klass.durationMin,
        levelName: level.name,
        levelColor: level.color,
        locationName: location.name,
        instructorId: klass.instructorId,
      })
      .from(classOccurrence)
      .innerJoin(klass, eq(klass.id, classOccurrence.klassId))
      .innerJoin(level, eq(level.id, klass.levelId))
      .innerJoin(location, eq(location.id, klass.locationId))
      .where(
        and(
          eq(classOccurrence.organizationId, organizationId),
          eq(classOccurrence.date, date),
          eq(classOccurrence.status, "scheduled"),
        ),
      )
      .orderBy(asc(klass.startTime), asc(klass.title));

    if (sessions.length === 0) return [];

    const klassIds = sessions.map((entry) => entry.klassId);
    const occurrenceIds = sessions.map((entry) => entry.occurrenceId);

    const [enrolled, marked] = await Promise.all([
      tx
        .select({
          klassId: enrollment.klassId,
          studentId: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          medicalNotes: student.medicalNotes,
        })
        .from(enrollment)
        .innerJoin(student, eq(student.id, enrollment.studentId))
        /** Condition extraite dans `roster.ts` pour être éprouvée telle quelle. */
        .where(rosterWindowCondition(organizationId, klassIds, date))
        .orderBy(asc(student.firstName), asc(student.lastName)),
      tx
        .select({
          occurrenceId: attendance.classOccurrenceId,
          studentId: attendance.studentId,
          status: attendance.status,
        })
        .from(attendance)
        .where(
          and(
            eq(attendance.organizationId, organizationId),
            inArray(attendance.classOccurrenceId, occurrenceIds),
          ),
        ),
    ]);

    const markedByKey = new Map(
      marked.map((row) => [`${row.occurrenceId}:${row.studentId}`, row.status]),
    );

    return sessions.map((session) => ({
      ...session,
      roster: enrolled
        .filter((row) => row.klassId === session.klassId)
        .map((row) => ({
          studentId: row.studentId,
          studentName: `${row.firstName} ${row.lastName}`,
          medicalNotes: row.medicalNotes,
          status:
            markedByKey.get(`${session.occurrenceId}:${row.studentId}`) ?? null,
        })),
    }));
  });
}

export type StudentSkill = {
  skillId: string;
  name: string;
  status: ProgressStatus | null;
};

export type StudentLevelProgress = LevelWithSkills & {
  entries: StudentSkill[];
};

/**
 * Progression d'un élève sur tout le curriculum de son école.
 *
 * Renvoie chaque niveau avec ses compétences et l'état de l'élève. Une
 * compétence sans ligne vaut « pas commencée » — l'absence est l'information.
 */
export async function getStudentProgress(
  organizationId: string,
  studentId: string,
): Promise<StudentLevelProgress[]> {
  return withTenant(organizationId, (tx) =>
    readStudentProgress(tx, organizationId, studentId),
  );
}

/**
 * Le calcul lui-même, sur une transaction déjà ouverte.
 *
 * Extrait pour que le portail parent le réutilise **à l'identique** sous
 * `withFamily()` : la progression d'un enfant est la même quel que soit le
 * sujet qui la regarde, seule la découpe d'accès change. En écrire une seconde
 * version côté parent, c'est se garantir qu'un jour les deux divergeront et
 * qu'un badge s'affichera différemment selon l'écran.
 */
export async function readStudentProgress(
  tx: TenantTransaction,
  organizationId: string,
  studentId: string,
): Promise<StudentLevelProgress[]> {
  {
    const [levels, skills, marks] = await Promise.all([
      tx
        .select({
          id: level.id,
          name: level.name,
          color: level.color,
          sortOrder: level.sortOrder,
        })
        .from(level)
        .where(eq(level.organizationId, organizationId))
        .orderBy(asc(level.sortOrder)),
      tx
        .select({ id: skill.id, name: skill.name, levelId: skill.levelId })
        .from(skill)
        .where(eq(skill.organizationId, organizationId))
        .orderBy(asc(skill.sortOrder)),
      tx
        .select({ skillId: skillProgress.skillId, status: skillProgress.status })
        .from(skillProgress)
        .where(
          and(
            eq(skillProgress.organizationId, organizationId),
            eq(skillProgress.studentId, studentId),
          ),
        ),
    ]);

    const statusBySkill = new Map(marks.map((row) => [row.skillId, row.status]));

    return levels.map((entry) => {
      const own = skills.filter((row) => row.levelId === entry.id);

      return {
        ...entry,
        skills: own.map((row) => ({ id: row.id, name: row.name })),
        entries: own.map((row) => ({
          skillId: row.id,
          name: row.name,
          status: statusBySkill.get(row.id) ?? null,
        })),
      };
    });
  }
}

/**
 * Compétences à cocher au bord du bassin, pour chaque élève d'une séance.
 *
 * Limitées au **niveau courant** de l'élève : le coach n'a pas à faire défiler
 * tout le curriculum pour trouver les deux cases du jour. Un élève sans niveau
 * assigné renvoie une liste vide — l'écran le dira plutôt que d'afficher un
 * vide inexplicable.
 */
export async function getPoolsideSkills(
  organizationId: string,
  studentIds: readonly string[],
): Promise<Map<string, { levelName: string; entries: StudentSkill[] }>> {
  if (studentIds.length === 0) return new Map();

  return withTenant(organizationId, async (tx) => {
    const students = await tx
      .select({
        id: student.id,
        levelId: student.currentLevelId,
        levelName: level.name,
      })
      .from(student)
      .leftJoin(level, eq(level.id, student.currentLevelId))
      .where(
        and(
          eq(student.organizationId, organizationId),
          inArray(student.id, [...studentIds]),
        ),
      );

    const levelIds = students
      .map((row) => row.levelId)
      .filter((id): id is string => id !== null);

    if (levelIds.length === 0) return new Map();

    const [skills, marks] = await Promise.all([
      tx
        .select({ id: skill.id, name: skill.name, levelId: skill.levelId })
        .from(skill)
        .where(
          and(
            eq(skill.organizationId, organizationId),
            inArray(skill.levelId, levelIds),
          ),
        )
        .orderBy(asc(skill.sortOrder)),
      tx
        .select({
          studentId: skillProgress.studentId,
          skillId: skillProgress.skillId,
          status: skillProgress.status,
        })
        .from(skillProgress)
        .where(
          and(
            eq(skillProgress.organizationId, organizationId),
            inArray(skillProgress.studentId, [...studentIds]),
          ),
        ),
    ]);

    const statusByPair = new Map(
      marks.map((row) => [`${row.studentId}:${row.skillId}`, row.status]),
    );

    const result = new Map<
      string,
      { levelName: string; entries: StudentSkill[] }
    >();

    for (const row of students) {
      if (!row.levelId || !row.levelName) continue;

      result.set(row.id, {
        levelName: row.levelName,
        entries: skills
          .filter((entry) => entry.levelId === row.levelId)
          .map((entry) => ({
            skillId: entry.id,
            name: entry.name,
            status: statusByPair.get(`${row.id}:${entry.id}`) ?? null,
          })),
      });
    }

    return result;
  });
}

export type BillingOverview = {
  plans: TuitionPlan[];
  subscriptions: {
    id: string;
    familyName: string;
    planName: string | null;
    status: string;
    currentPeriodEnd: Date | null;
  }[];
  invoices: {
    id: string;
    familyName: string;
    amount: number;
    currency: string;
    status: string;
    dueDate: Date | null;
    paidAt: Date | null;
    /** Page de paiement Stripe : c'est le lien qu'on transmet à la famille. */
    hostedInvoiceUrl: string | null;
  }[];
  /**
   * `billed` distingue les familles qui ont un dossier de paiement chez Stripe.
   * Seules celles-là ont un portail à ouvrir.
   */
  families: { id: string; label: string; billed: boolean }[];
};

/** Tout ce qu'affiche l'écran Facturation : tarifs, abonnements, factures. */
export async function getBillingOverview(
  organizationId: string,
): Promise<BillingOverview> {
  return withTenant(organizationId, async (tx) => {
    const [plans, subscriptions, invoices, families] = await Promise.all([
      tx
        .select()
        .from(tuitionPlan)
        .where(eq(tuitionPlan.organizationId, organizationId))
        .orderBy(asc(tuitionPlan.name)),
      tx
        .select({
          id: subscription.id,
          familyName: family.primaryGuardianName,
          planName: tuitionPlan.name,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        })
        .from(subscription)
        .innerJoin(family, eq(family.id, subscription.familyId))
        .leftJoin(tuitionPlan, eq(tuitionPlan.id, subscription.tuitionPlanId))
        .where(eq(subscription.organizationId, organizationId))
        .orderBy(asc(family.primaryGuardianName)),
      tx
        .select({
          id: invoice.id,
          familyName: family.primaryGuardianName,
          amount: invoice.amount,
          currency: invoice.currency,
          status: invoice.status,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        })
        .from(invoice)
        .innerJoin(family, eq(family.id, invoice.familyId))
        .where(eq(invoice.organizationId, organizationId))
        .orderBy(desc(invoice.createdAt))
        .limit(25),
      tx
        .select({
          id: family.id,
          label: family.primaryGuardianName,
          /**
           * Un booléen plutôt que l'identifiant Stripe : l'écran a seulement
           * besoin de savoir s'il y a un portail à ouvrir, pas de connaître le
           * dossier de paiement de la famille.
           */
          billed: sql<boolean>`${isNotNull(family.stripeCustomerId)}`,
        })
        .from(family)
        .where(eq(family.organizationId, organizationId))
        .orderBy(asc(family.primaryGuardianName)),
    ]);

    return { plans, subscriptions, invoices, families };
  });
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

export type EnrollmentToReview = {
  id: string;
  studentName: string;
  studentLevelName: string | null;
  studentLevelSort: number | null;
  klassTitle: string;
  klassLevelName: string | null;
  klassLevelSort: number | null;
  status: string;
  guardianName: string | null;
  createdAt: Date;
};

/**
 * Les inscriptions faites par les familles et non encore relues.
 *
 * ── Le contrepoids du « active direct » ──────────────────────────────────────
 *
 * Un parent inscrit son enfant sans approbation préalable. Ce choix n'est
 * tenable que si l'école peut **retirer en aval** — et elle ne le peut que si
 * elle voit ce qui est arrivé. Cette file est donc la condition de ce choix,
 * pas un confort d'écran.
 *
 * ── Une file, pas un flux ────────────────────────────────────────────────────
 *
 * Le filtre porte sur `reviewed_at is null`, jamais sur une date récente. Une
 * fenêtre de temps laisserait une inscription douteuse sortir de vue avant
 * qu'on l'ait regardée, et d'autant plus sûrement en haute saison — quand il y
 * en a le plus. Ici, rien ne part sans avoir été traité.
 *
 * Les rangs des deux niveaux sont rapportés pour que l'écart saute aux yeux :
 * un débutant inscrit dans un cours avancé se repère d'un coup d'œil, sans
 * comparer des noms.
 */
export async function getEnrollmentsToReview(
  organizationId: string,
): Promise<EnrollmentToReview[]> {
  const studentLevel = alias(level, "student_level");
  const klassLevel = alias(level, "klass_level");

  return withTenant(organizationId, async (tx) =>
    tx
      .select({
        id: enrollment.id,
        studentName: student.firstName,
        studentLevelName: studentLevel.name,
        studentLevelSort: studentLevel.sortOrder,
        klassTitle: klass.title,
        klassLevelName: klassLevel.name,
        klassLevelSort: klassLevel.sortOrder,
        status: enrollment.status,
        guardianName: guardian.name,
        createdAt: enrollment.createdAt,
      })
      .from(enrollment)
      .innerJoin(student, eq(student.id, enrollment.studentId))
      .innerJoin(klass, eq(klass.id, enrollment.klassId))
      .leftJoin(studentLevel, eq(studentLevel.id, student.currentLevelId))
      .leftJoin(klassLevel, eq(klassLevel.id, klass.levelId))
      .leftJoin(guardian, eq(guardian.id, enrollment.enrolledByGuardianId))
      .where(
        and(
          eq(enrollment.organizationId, organizationId),
          isNotNull(enrollment.enrolledByGuardianId),
          isNull(enrollment.reviewedAt),
          inArray(enrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        ),
      )
      .orderBy(desc(enrollment.createdAt)),
  );
}
