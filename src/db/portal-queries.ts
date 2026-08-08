import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  LIVE_ENROLLMENT_STATUSES,
  SEAT_TAKING_STATUSES,
} from "@/config/enrollment";

import { withFamily } from "./tenant";
import { UNPAID_INVOICE_STATUSES } from "@/config/billing";
import { ROSTER_EXCLUDED_STATUSES } from "@/config/enrollment";
import { MAKEUP_OCCUPYING_STATUSES, type MakeupDerivedState } from "@/config/makeup";
import { CANCELLED_OCCURRENCE_STATUS } from "@/config/scheduling";
import { makeupCreditState } from "@/lib/makeup";

import {
  classOccurrence,
  enrollment,
  family,
  invoice,
  makeupCredit,
  klass,
  level,
  location,
  organization,
  program,
  student,
  term,
} from "./schema";
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

export type PortalClass = {
  id: string;
  title: string;
  levelName: string | null;
  levelColor: string | null;
  locationName: string | null;
  dayOfWeek: number;
  startTime: string;
  durationMin: number;
  capacity: number;
  taken: number;
};

export type PortalEnrollment = {
  id: string;
  studentId: string;
  studentFirstName: string;
  klassTitle: string;
  levelName: string | null;
  levelColor: string | null;
  dayOfWeek: number;
  startTime: string;
  status: string;
  klassId: string;
  /** Rang dans la file — `null` hors liste d'attente. */
  waitlistRank: number | null;
};

/**
 * Les cours de l'école, avec leur occupation.
 *
 * ── Le décompte ne peut pas être une lecture directe ────────────────────────
 *
 * `enrollment` est restreinte aux enfants du foyer : compter ses lignes
 * donnerait « 0 occupée » sur chaque cours. Le nombre passe donc par
 * `count_seats_taken`, qui échappe à la RLS **en réimposant la frontière
 * d'école** et qui lève plutôt que de rendre un zéro trompeur.
 *
 * Ce nombre est **indicatif**. Il peut être périmé au moment où le parent
 * clique, et ce n'est pas un défaut : le verrou pris à l'inscription décide
 * seul. Une classe qui se remplit entre l'affichage et le clic fait atterrir
 * l'enfant en liste d'attente — pas en erreur.
 */
export async function getPortalClasses(
  organizationId: string,
  familyId: string,
): Promise<PortalClass[]> {
  return withFamily(organizationId, familyId, async (tx) => {
    const rows = await tx
      .select({
        id: klass.id,
        title: klass.title,
        levelName: level.name,
        levelColor: level.color,
        locationName: location.name,
        dayOfWeek: klass.dayOfWeek,
        startTime: klass.startTime,
        durationMin: klass.durationMin,
        capacity: klass.capacity,
      })
      .from(klass)
      .leftJoin(level, eq(level.id, klass.levelId))
      .leftJoin(location, eq(location.id, klass.locationId))
      .where(and(eq(klass.organizationId, organizationId), eq(klass.active, true)))
      .orderBy(asc(klass.dayOfWeek), asc(klass.startTime));

    return Promise.all(
      rows.map(async (row) => {
        const counted = await tx.execute(
          sql`select count_seats_taken(${row.id}::uuid, ${sql.param([
            ...SEAT_TAKING_STATUSES,
          ])}::text[]) as total`,
        );

        return {
          ...row,
          taken: Number(
            (counted.rows[0] as { total: number | string }).total ?? 0,
          ),
        };
      }),
    );
  });
}

/**
 * Les inscriptions du foyer, tous enfants confondus.
 *
 * ── Pourquoi aucun rang de liste d'attente n'est affiché ────────────────────
 *
 * Le rang se dérive de **toutes** les inscriptions en attente du cours, classées
 * par `waitlisted_at`. Sous contexte famille, le parent ne voit que les
 * siennes : le calcul rendrait « 1 » à tout le monde, en permanence.
 *
 * D'où `waitlist_rank_for_family`, qui échappe à la RLS pour voir la file
 * entière. Et qui ne reçoit **que le cours** : la cible — quelle inscription
 * classer — est dérivée du foyer courant. Lui passer un `enrollment_id`
 * laisserait un parent apprendre le rang de l'enfant d'un autre foyer.
 *
 * La cible sensible vient de l'identité ; seul le contexte vient de la requête.
 */
export async function getPortalEnrollments(
  organizationId: string,
  familyId: string,
): Promise<PortalEnrollment[]> {
  return withFamily(organizationId, familyId, async (tx) =>
    tx
      .select({
        id: enrollment.id,
        studentId: student.id,
        studentFirstName: student.firstName,
        klassTitle: klass.title,
        levelName: level.name,
        levelColor: level.color,
        dayOfWeek: klass.dayOfWeek,
        startTime: klass.startTime,
        status: enrollment.status,
        klassId: enrollment.klassId,
      })
      .from(enrollment)
      .innerJoin(student, eq(student.id, enrollment.studentId))
      .innerJoin(klass, eq(klass.id, enrollment.klassId))
      .leftJoin(level, eq(level.id, klass.levelId))
      .where(
        and(
          eq(enrollment.organizationId, organizationId),
          inArray(enrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        ),
      )
      .orderBy(asc(student.firstName), asc(klass.dayOfWeek))
      .then((rows) =>
        Promise.all(
          rows.map(async (row) => {
            if (row.status !== "waitlisted") {
              return { ...row, waitlistRank: null };
            }

            const ranked = await tx.execute(
              sql`select waitlist_rank_for_family(${row.klassId}::uuid) as rank`,
            );

            const rank = (ranked.rows[0] as { rank: number | null }).rank;
            return { ...row, waitlistRank: rank === null ? null : Number(rank) };
          }),
        ),
      ),
  );
}

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

export type PortalBilling = {
  /** `false` quand l'école n'a pas encore mis ce foyer en facturation. */
  configured: boolean;
  invoices: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    dueDate: Date | null;
    paidAt: Date | null;
    hostedInvoiceUrl: string | null;
  }[];
  /** Somme des factures ouvertes, en plus petite unité monétaire. */
  outstanding: number;
};

/**
 * Les factures du foyer.
 *
 * ── Une lecture directe, et c'est délibéré ──────────────────────────────────
 *
 * Le total dû agrège **à l'intérieur** du foyer : un parent additionne ses
 * propres factures, et la RLS lui donne déjà exactement celles-là. Pas de
 * `security definer` ici — sortir la fonction lourde là où la donnée est déjà
 * scopée ajouterait une exception inutile à la liste, et la valeur de cette
 * liste tient à sa brièveté. Chaque exception réflexe dilue le sens de toutes
 * les autres.
 *
 * La règle est « agrège **hors** du foyer », pas « agrège ». Le solde n'en sort
 * pas.
 *
 * ── Une famille sans dossier de paiement est un ÉTAT ────────────────────────
 *
 * C'est l'école qui crée le client Stripe, en abonnant le foyer ou en lui
 * émettant une facture. Tant qu'elle ne l'a pas fait, `stripe_customer_id` est
 * nul — ce n'est pas une panne. Le portail **lit et paie l'existant ; il ne se
 * provisionne jamais lui-même**. Créer le client ici en dupliquerait un que
 * l'école créera, et le webhook ne saurait plus à quelle famille rattacher quoi.
 */
export async function getPortalBilling(
  organizationId: string,
  familyId: string,
): Promise<PortalBilling> {
  return withFamily(organizationId, familyId, async (tx) => {
    const [household] = await tx
      .select({ customerId: family.stripeCustomerId })
      .from(family)
      .where(eq(family.id, familyId))
      .limit(1);

    const rows = await tx
      .select({
        id: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      })
      .from(invoice)
      .where(eq(invoice.organizationId, organizationId))
      .orderBy(desc(invoice.createdAt));

    return {
      configured: Boolean(household?.customerId),
      invoices: rows,
      outstanding: rows
        .filter((row) => UNPAID_INVOICE_STATUSES.includes(row.status))
        .reduce((total, row) => total + row.amount, 0),
    };
  });
}

export type PortalMakeup = {
  /** Séances à venir où l'enfant est inscrit — celles qu'on peut manquer. */
  upcoming: {
    occurrenceId: string;
    studentId: string;
    studentFirstName: string;
    klassTitle: string;
    date: string;
    alreadyReported: boolean;
  }[];
  /** Crédits utilisables, et les séances où les poser. */
  credits: {
    creditId: string;
    studentFirstName: string;
    missedOn: string;
    usableThrough: string | null;
    state: MakeupDerivedState;
    options: {
      occurrenceId: string;
      klassTitle: string;
      date: string;
      seatsLeft: number;
    }[];
  }[];
};

/**
 * Tout ce que le portail montre des rattrapages.
 *
 * ── Les places affichées sont indicatives ───────────────────────────────────
 *
 * Comme à l'inscription, le nombre montré peut être périmé au moment du tap. Ce
 * n'est pas un défaut : le verrou pris sur la SÉANCE décide seul. Une séance
 * qui se remplit entre-temps produit un refus expliqué — « c'était plein » —
 * jamais une erreur technique.
 *
 * ── L'échéance est lue vivante ──────────────────────────────────────────────
 *
 * `coalesce(extended_until, term.end_date)` : aucune date figée à la création.
 * Une école qui prolonge son trimestre prolonge ses crédits, sans qu'une seule
 * ligne soit réécrite.
 */
export async function getPortalMakeups(
  organizationId: string,
  familyId: string,
  today: string,
): Promise<PortalMakeup> {
  return withFamily(organizationId, familyId, async (tx) => {
    const missed = alias(classOccurrence, "missed");
    const missedKlass = alias(klass, "missed_klass");

    /** Séances à venir où l'enfant est régulièrement inscrit. */
    const upcomingRows = await tx
      .select({
        occurrenceId: classOccurrence.id,
        studentId: student.id,
        studentFirstName: student.firstName,
        klassTitle: klass.title,
        date: classOccurrence.date,
        creditId: makeupCredit.id,
      })
      .from(classOccurrence)
      .innerJoin(klass, eq(klass.id, classOccurrence.klassId))
      .innerJoin(
        enrollment,
        and(
          eq(enrollment.klassId, classOccurrence.klassId),
          eq(enrollment.organizationId, organizationId),
          ne(enrollment.status, "waitlisted"),
          lte(enrollment.startDate, classOccurrence.date),
          or(
            isNull(enrollment.endDate),
            gte(enrollment.endDate, classOccurrence.date),
          ),
        )!,
      )
      .innerJoin(student, eq(student.id, enrollment.studentId))
      .leftJoin(
        makeupCredit,
        and(
          eq(makeupCredit.missedOccurrenceId, classOccurrence.id),
          eq(makeupCredit.studentId, student.id),
        ),
      )
      .where(
        and(
          eq(classOccurrence.organizationId, organizationId),
          gt(classOccurrence.date, today),
          ne(classOccurrence.status, CANCELLED_OCCURRENCE_STATUS),
        ),
      )
      .orderBy(asc(classOccurrence.date), asc(student.firstName))
      .limit(20);

    /** Les crédits du foyer, avec leur échéance dérivée. */
    const creditRows = await tx
      .select({
        creditId: makeupCredit.id,
        studentFirstName: student.firstName,
        studentLevelId: student.currentLevelId,
        status: makeupCredit.status,
        missedOn: missed.date,
        usableThrough: sql<string | null>`coalesce(${makeupCredit.extendedUntil}, ${term.endDate})`,
        bookedOn: classOccurrence.date,
        bookedStatus: classOccurrence.status,
      })
      .from(makeupCredit)
      .innerJoin(student, eq(student.id, makeupCredit.studentId))
      .innerJoin(missed, eq(missed.id, makeupCredit.missedOccurrenceId))
      .innerJoin(missedKlass, eq(missedKlass.id, missed.klassId))
      .innerJoin(term, eq(term.id, missedKlass.termId))
      .leftJoin(
        classOccurrence,
        eq(classOccurrence.id, makeupCredit.bookedOccurrenceId),
      )
      .where(eq(makeupCredit.organizationId, organizationId))
      .orderBy(asc(missed.date));

    const credits = [];

    for (const row of creditRows) {
      const state = makeupCreditState({
        status: row.status,
        usableThrough: row.usableThrough,
        bookedOn: row.bookedOn,
        bookedOccurrenceStatus: row.bookedStatus,
        today,
      });

      /**
       * Les séances où poser ce crédit : à venir, du niveau ACTUEL de l'enfant.
       * Pas une contrainte administrative — de l'eau plus profonde et un
       * encadrement pensé pour un autre public.
       */
      const options =
        state === "available" && row.studentLevelId
          ? await tx
              .select({
                occurrenceId: classOccurrence.id,
                klassTitle: klass.title,
                date: classOccurrence.date,
                capacity: klass.capacity,
              })
              .from(classOccurrence)
              .innerJoin(klass, eq(klass.id, classOccurrence.klassId))
              .where(
                and(
                  eq(classOccurrence.organizationId, organizationId),
                  gt(classOccurrence.date, today),
                  ne(classOccurrence.status, CANCELLED_OCCURRENCE_STATUS),
                  eq(klass.levelId, row.studentLevelId),
                ),
              )
              .orderBy(asc(classOccurrence.date))
              .limit(10)
          : [];

      const withSeats = [];

      for (const option of options) {
        const counted = await tx.execute(
          sql`select count_occurrence_attendees(
                ${option.occurrenceId}::uuid,
                ${sql.param([...ROSTER_EXCLUDED_STATUSES])}::text[],
                ${sql.param([...MAKEUP_OCCUPYING_STATUSES])}::text[]
              ) as total`,
        );

        const taken = Number(
          (counted.rows[0] as { total: number | string }).total ?? 0,
        );

        if (taken < option.capacity) {
          withSeats.push({
            occurrenceId: option.occurrenceId,
            klassTitle: option.klassTitle,
            date: option.date,
            seatsLeft: option.capacity - taken,
          });
        }
      }

      credits.push({
        creditId: row.creditId,
        studentFirstName: row.studentFirstName,
        missedOn: row.missedOn,
        usableThrough: row.usableThrough,
        state,
        options: withSeats,
      });
    }

    return {
      upcoming: upcomingRows.map((row) => ({
        occurrenceId: row.occurrenceId,
        studentId: row.studentId,
        studentFirstName: row.studentFirstName,
        klassTitle: row.klassTitle,
        date: row.date,
        alreadyReported: row.creditId !== null,
      })),
      credits,
    };
  });
}
