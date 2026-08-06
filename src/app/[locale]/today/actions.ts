"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/config/attendance";
import { routes } from "@/config/routes";
import { attendance, classOccurrence, student } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { ActionResult } from "@/lib/action-result";
import { runAuthorizedAction, ValidationError } from "@/lib/actions";

/**
 * Enregistrement de la présence.
 *
 * Reçoit un **lot** plutôt qu'un relevé isolé : la file locale du bord du
 * bassin se vide en un seul envoi quand le réseau revient.
 *
 * L'opération est un `upsert` sur la contrainte d'unicité
 * (école, séance, élève). C'est ce qui la rend rejouable : renvoyer deux fois
 * le même lot produit exactement le même état, jamais de doublon. Sans cette
 * propriété, une file qui retente serait dangereuse — et une file qu'on ne peut
 * pas retenter ne servirait à rien.
 */

export type AttendanceEntry = {
  occurrenceId: string;
  studentId: string;
  status: AttendanceStatus;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Le lot vient du navigateur : rien n'y est digne de confiance. */
function parseEntries(raw: unknown): AttendanceEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("Lot de présence vide ou mal formé.");
  }

  return raw.map((entry) => {
    const candidate = entry as Partial<AttendanceEntry>;

    if (
      typeof candidate.occurrenceId !== "string" ||
      !UUID_PATTERN.test(candidate.occurrenceId) ||
      typeof candidate.studentId !== "string" ||
      !UUID_PATTERN.test(candidate.studentId) ||
      typeof candidate.status !== "string" ||
      !(ATTENDANCE_STATUSES as readonly string[]).includes(candidate.status)
    ) {
      throw new ValidationError("Relevé de présence mal formé.");
    }

    return candidate as AttendanceEntry;
  });
}

export async function submitAttendance(raw: unknown): Promise<ActionResult> {
  return runAuthorizedAction("attendance:write", async (context) => {
    const entries = parseEntries(raw);

    await withTenant(context.organizationId, async (tx) => {
      /**
       * Séances et élèves sont vérifiés en une requête chacun plutôt qu'une par
       * ligne : un lot de trente relevés ne doit pas produire soixante allers-
       * retours. Le contrôle reste soumis à la RLS, donc au tenant.
       */
      const occurrenceIds = [...new Set(entries.map((e) => e.occurrenceId))];
      const studentIds = [...new Set(entries.map((e) => e.studentId))];

      const [validOccurrences, validStudents] = await Promise.all([
        tx
          .select({ id: classOccurrence.id })
          .from(classOccurrence)
          .where(
            and(
              eq(classOccurrence.organizationId, context.organizationId),
              inArray(classOccurrence.id, occurrenceIds),
              /** Une séance annulée n'a pas de présence à relever. */
              eq(classOccurrence.status, "scheduled"),
            ),
          ),
        tx
          .select({ id: student.id })
          .from(student)
          .where(
            and(
              eq(student.organizationId, context.organizationId),
              inArray(student.id, studentIds),
            ),
          ),
      ]);

      const knownOccurrences = new Set(validOccurrences.map((row) => row.id));
      const knownStudents = new Set(validStudents.map((row) => row.id));

      const accepted = entries.filter(
        (entry) =>
          knownOccurrences.has(entry.occurrenceId) &&
          knownStudents.has(entry.studentId),
      );

      if (accepted.length === 0) {
        throw new ValidationError(
          "Aucune séance exploitable dans ce lot.",
          "notInThisSchool",
        );
      }

      await tx
        .insert(attendance)
        .values(
          accepted.map((entry) => ({
            organizationId: context.organizationId,
            classOccurrenceId: entry.occurrenceId,
            studentId: entry.studentId,
            status: entry.status,
            /**
             * Toujours la session qui écrit, jamais une identité affirmée par
             * le navigateur. La file étant cloisonnée par membre, l'attribution
             * est correcte sans qu'il faille faire confiance au client.
             */
            markedBy: context.staffUserId,
            markedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [
            attendance.organizationId,
            attendance.classOccurrenceId,
            attendance.studentId,
          ],
          /**
           * `excluded` désigne la ligne refusée par le conflit : le relevé le
           * plus récemment arrivé remplace le précédent. Dernier arrivé gagne,
           * à l'horloge du serveur — jamais à celle d'une tablette qui peut
           * être mal réglée.
           */
          set: {
            status: sql`excluded.status`,
            markedBy: sql`excluded.marked_by`,
            markedAt: sql`excluded.marked_at`,
          },
        });
    });

    revalidatePath(`/[locale]${routes.today}`, "page");
  });
}
