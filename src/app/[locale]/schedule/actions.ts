"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import {
  CLASS_CAPACITY,
  CLASS_DURATION_MINUTES,
  DATE_PATTERN,
  isDayOfWeek,
  MAX_GENERATED_OCCURRENCES,
  OCCURRENCE_STATUSES,
  TIME_PATTERN,
} from "@/config/scheduling";
import { FIELD_LIMITS } from "@/config/validation";
import {
  classOccurrence,
  klass,
  level,
  location,
  organization,
  staffUser,
  term,
} from "@/db/schema";
import { withTenant, type TenantTransaction } from "@/db/tenant";
import { assertBelongsToTenant } from "@/db/tenant-guard";
import type { ActionResult } from "@/lib/action-result";
import {
  optionalUuid,
  requiredEnum,
  requiredText,
  requiredUuid,
  runAuthorizedAction,
  ValidationError,
} from "@/lib/actions";
import {
  occurrenceDatesFor,
  planOccurrenceReconciliation,
  todayInTimeZone,
} from "@/lib/occurrences";

/**
 * Écritures du planning : sessions, cours récurrents, séances datées.
 *
 * Un cours référence cinq lignes d'autres tables. Chacune est vérifiée par une
 * lecture soumise à la RLS — les contraintes Postgres, elles, accepteraient le
 * lieu ou le niveau d'une école concurrente.
 */

const SCHEDULE_PATH = `/[locale]${routes.schedule}`;
const TERMS_PATH = `/[locale]${routes.terms}`;

function revalidateSchedule() {
  revalidatePath(SCHEDULE_PATH, "page");
  revalidatePath(TERMS_PATH, "page");
}

function requiredDate(formData: FormData, field: string): string {
  const raw = formData.get(field);

  if (typeof raw !== "string" || !DATE_PATTERN.test(raw)) {
    throw new ValidationError(`Date « ${field} » absente ou mal formée.`);
  }

  if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new ValidationError(`Date « ${raw} » inexistante.`);
  }

  return raw;
}

function requiredBoundedInteger(
  formData: FormData,
  field: string,
  bounds: { minimum: number; maximum: number },
): number {
  const raw = formData.get(field);
  const value = Number(raw);

  if (
    typeof raw !== "string" ||
    !Number.isInteger(value) ||
    value < bounds.minimum ||
    value > bounds.maximum
  ) {
    throw new ValidationError(
      `Valeur « ${field} » hors des bornes ${bounds.minimum}–${bounds.maximum}.`,
    );
  }

  return value;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function readTermDates(formData: FormData) {
  const startDate = requiredDate(formData, "startDate");
  const endDate = requiredDate(formData, "endDate");

  if (endDate < startDate) {
    throw new ValidationError("La date de fin précède la date de début.");
  }

  return { startDate, endDate };
}

export async function createTerm(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const { startDate, endDate } = readTermDates(formData);

    await withTenant(context.organizationId, (tx) =>
      tx.insert(term).values({
        organizationId: context.organizationId,
        name,
        startDate,
        endDate,
        enrollmentOpen: formData.get("enrollmentOpen") === "true",
      }),
    );

    revalidateSchedule();
  });
}

export async function updateTerm(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const termId = requiredUuid(formData, "termId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const { startDate, endDate } = readTermDates(formData);

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(term)
        .set({
          name,
          startDate,
          endDate,
          enrollmentOpen: formData.get("enrollmentOpen") === "true",
        })
        .where(
          and(
            eq(term.id, termId),
            eq(term.organizationId, context.organizationId),
          ),
        ),
    );

    /**
     * Les séances ne sont pas régénérées automatiquement. Modifier des dates
     * peut retirer des séances : cela doit rester un geste explicite, pas un
     * effet de bord d'un changement de nom.
     */
    revalidateSchedule();
  });
}

export async function deleteTerm(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const termId = requiredUuid(formData, "termId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(term)
        .where(
          and(
            eq(term.id, termId),
            eq(term.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateSchedule();
  });
}

// ─── Cours ───────────────────────────────────────────────────────────────────

/**
 * Vérifie les références d'un cours et renvoie le programme, déduit du niveau.
 *
 * Chaque référence est contrôlée par une lecture soumise à la RLS : les
 * contraintes Postgres, elles, accepteraient la session, le lieu ou le niveau
 * d'une école concurrente.
 *
 * L'instructeur doit en outre être **actif** — un membre désactivé a perdu ses
 * accès, lui attribuer un cours n'aurait pas de sens.
 */
async function assertClassReferences(
  tx: TenantTransaction,
  organizationId: string,
  references: {
    termId: string;
    levelId: string;
    locationId: string;
    instructorId: string | null;
  },
): Promise<string> {
  await assertBelongsToTenant(tx, term, "term", references.termId, organizationId);
  await assertBelongsToTenant(
    tx,
    location,
    "location",
    references.locationId,
    organizationId,
  );

  /**
   * Le programme n'est pas demandé au formulaire : il se déduit du niveau.
   *
   * Le faire saisir imposerait de tenir deux champs cohérents entre eux, et
   * ouvrirait la porte à un cours « Learn to Swim / Dauphin » où Dauphin
   * relèverait d'un autre programme. Une donnée dérivable ne se saisit pas.
   */
  const [levelRow] = await tx
    .select({ programId: level.programId })
    .from(level)
    .where(
      and(
        eq(level.id, references.levelId),
        eq(level.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!levelRow) {
    throw new ValidationError("Ce niveau n'existe pas dans cette école.");
  }

  if (references.instructorId) {
    const [member] = await tx
      .select({ id: staffUser.id })
      .from(staffUser)
      .where(
        and(
          eq(staffUser.id, references.instructorId),
          eq(staffUser.organizationId, organizationId),
          eq(staffUser.active, true),
        ),
      )
      .limit(1);

    if (!member) {
      throw new ValidationError(
        "L'instructeur choisi n'est pas un membre actif de cette école.",
      );
    }
  }

  return levelRow.programId;
}

function readClassFields(formData: FormData) {
  const startTime = formData.get("startTime");

  if (typeof startTime !== "string" || !TIME_PATTERN.test(startTime)) {
    throw new ValidationError("Heure de début absente ou mal formée.");
  }

  const dayOfWeek = Number(formData.get("dayOfWeek"));

  if (!isDayOfWeek(dayOfWeek)) {
    throw new ValidationError(`Jour « ${dayOfWeek} » hors de 0–6.`);
  }

  return {
    title: requiredText(formData, "title", FIELD_LIMITS.name),
    termId: requiredUuid(formData, "termId"),
    levelId: requiredUuid(formData, "levelId"),
    locationId: requiredUuid(formData, "locationId"),
    instructorId: optionalUuid(formData, "instructorId"),
    dayOfWeek,
    startTime,
    durationMin: requiredBoundedInteger(
      formData,
      "durationMin",
      CLASS_DURATION_MINUTES,
    ),
    capacity: requiredBoundedInteger(formData, "capacity", CLASS_CAPACITY),
  };
}

export async function createClass(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const fields = readClassFields(formData);

    await withTenant(context.organizationId, async (tx) => {
      const programId = await assertClassReferences(
        tx,
        context.organizationId,
        fields,
      );

      await tx
        .insert(klass)
        .values({ organizationId: context.organizationId, programId, ...fields });
    });

    revalidateSchedule();
  });
}

export async function updateClass(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const klassId = requiredUuid(formData, "klassId");
    const fields = readClassFields(formData);

    await withTenant(context.organizationId, async (tx) => {
      const programId = await assertClassReferences(
        tx,
        context.organizationId,
        fields,
      );

      await tx
        .update(klass)
        .set({ ...fields, programId })
        .where(
          and(
            eq(klass.id, klassId),
            eq(klass.organizationId, context.organizationId),
          ),
        );
    });

    revalidateSchedule();
  });
}

export async function deleteClass(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const klassId = requiredUuid(formData, "klassId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(klass)
        .where(
          and(
            eq(klass.id, klassId),
            eq(klass.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateSchedule();
  });
}

// ─── Séances datées ──────────────────────────────────────────────────────────

/**
 * Réconcilie les séances d'un cours avec les dates de sa session.
 *
 * Trois principes, hérités de la politique retenue :
 * **le passé est immuable · le futur vierge est régénérable · ce qui porte une
 * trace est protégé**. La décision elle-même est prise par
 * `planOccurrenceReconciliation`, logique pure éprouvée par
 * `npm run scheduling:verify`.
 */
export async function regenerateOccurrences(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const klassId = requiredUuid(formData, "klassId");

    await withTenant(context.organizationId, async (tx) => {
      const [row] = await tx
        .select({
          dayOfWeek: klass.dayOfWeek,
          startDate: term.startDate,
          endDate: term.endDate,
          timezone: organization.timezone,
        })
        .from(klass)
        .innerJoin(term, eq(term.id, klass.termId))
        .innerJoin(organization, eq(organization.id, klass.organizationId))
        .where(
          and(
            eq(klass.id, klassId),
            eq(klass.organizationId, context.organizationId),
          ),
        )
        .limit(1);

      if (!row) {
        throw new ValidationError("Ce cours n'existe pas dans cette école.");
      }

      const targetDates = occurrenceDatesFor(
        row.startDate,
        row.endDate,
        row.dayOfWeek,
      );

      if (targetDates.length > MAX_GENERATED_OCCURRENCES) {
        throw new ValidationError(
          `Cette session produirait ${targetDates.length} séances, au-delà de la limite de ${MAX_GENERATED_OCCURRENCES}. Vérifie ses dates.`,
        );
      }

      const existing = await tx
        .select({
          date: classOccurrence.date,
          status: classOccurrence.status,
        })
        .from(classOccurrence)
        .where(
          and(
            eq(classOccurrence.organizationId, context.organizationId),
            eq(classOccurrence.klassId, klassId),
          ),
        );

      const plan = planOccurrenceReconciliation({
        targetDates,
        existing: existing.map((entry) => ({
          date: entry.date,
          status: entry.status,
          /**
           * ⚠️ POINT D'EXTENSION SEMAINE 6 — présences.
           *
           * Dès que la table de présence existera, ce champ devra refléter
           * l'existence d'une ligne rattachée à la séance. Il vaut `false`
           * aujourd'hui parce qu'aucune donnée ne peut encore exister, pas
           * parce que la question serait sans objet.
           */
          hasDependencies: false,
        })),
        /** « Aujourd'hui » dans le fuseau de l'école, jamais celui du serveur. */
        today: todayInTimeZone(row.timezone),
      });

      if (plan.toCreate.length > 0) {
        await tx
          .insert(classOccurrence)
          .values(
            plan.toCreate.map((date) => ({
              organizationId: context.organizationId,
              klassId,
              date,
            })),
          )
          /** Filet en cas d'appels concurrents : l'unicité est en base. */
          .onConflictDoNothing();
      }

      if (plan.toDelete.length > 0) {
        await tx
          .delete(classOccurrence)
          .where(
            and(
              eq(classOccurrence.organizationId, context.organizationId),
              eq(classOccurrence.klassId, klassId),
              inArray(classOccurrence.date, plan.toDelete),
            ),
          );
      }
    });

    revalidateSchedule();
  });
}

/**
 * Annule ou rétablit une séance précise, sans toucher au cours récurrent.
 *
 * Une annulation reste une ligne : elle enregistre une décision, et la
 * régénération la respecte plutôt que de la recréer.
 */
export async function setOccurrenceStatus(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const occurrenceId = requiredUuid(formData, "occurrenceId");
    const status = requiredEnum(formData, "status", OCCURRENCE_STATUSES);

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(classOccurrence)
        .set({ status })
        .where(
          and(
            eq(classOccurrence.id, occurrenceId),
            eq(classOccurrence.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateSchedule();
  });
}
