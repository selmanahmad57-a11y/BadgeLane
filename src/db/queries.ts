import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
} from "drizzle-orm";

import type { AttendanceStatus } from "@/config/attendance";
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
  staffUser,
  student,
  term,
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
