"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import { hasLiveEnrollment, lockKlassAndCountSeats } from "@/db/enrollment";
import { enrollment, organization, student } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import { requiredUuid, ValidationError } from "@/lib/actions";
import { todayInTimeZone } from "@/lib/occurrences";
import { runParentAction } from "@/lib/parent-actions";
import type { Locale } from "@/config/i18n";

/**
 * La première écriture qu'un parent fait dans BadgeLane.
 *
 * ── Rien de neuf sous le capot ───────────────────────────────────────────────
 *
 * Elle appelle `lockKlassAndCountSeats` — le verrou de la Semaine 5 — sans le
 * recopier ni l'adapter. Une seconde implémentation « côté parent » aurait
 * divergé le jour où l'une des deux serait corrigée, et le surbooking serait
 * revenu par la porte qu'on n'aurait pas regardée.
 *
 * Le décompte, lui, passe par `count_seats_taken` : sous contexte famille, une
 * lecture directe d'`enrollment` ne verrait que les inscriptions du foyer et
 * croirait tout cours vide.
 *
 * ── Le choix n'est pas offert ────────────────────────────────────────────────
 *
 * Inscription ou liste d'attente découle du décompte fait **sous verrou**. Le
 * nombre affiché à l'écran peut être périmé au moment du clic — c'est normal,
 * et c'est même le cas intéressant : si la classe s'est remplie entre-temps, le
 * parent atterrit en liste d'attente au lieu de recevoir une erreur. Le nombre
 * affiché informe ; le verrou décide.
 *
 * ── Ce qui est écrit en plus ─────────────────────────────────────────────────
 *
 * `enrolledByGuardianId` : la provenance. C'est elle qui permettra à l'école de
 * relire ce que les familles ont fait — et sans cette relecture, « l'école
 * garde la main » ne voudrait rien dire.
 */
export async function enrolChild(
  locale: Locale,
  formData: FormData,
): Promise<ActionResult> {
  const familyId = requiredUuid(formData, "familyId");

  return runParentAction(
    locale,
    "enrollment:self",
    familyId,
    async (context, tx) => {
      const klassId = requiredUuid(formData, "klassId");
      const studentId = requiredUuid(formData, "studentId");

      /**
       * L'élève appartient-il au foyer ? La RLS le garantit déjà — le contexte
       * famille est posé — mais on le lit explicitement pour distinguer
       * « pas ton enfant » d'un cours introuvable, et servir le bon message.
       */
      const [owned] = await tx
        .select({ id: student.id })
        .from(student)
        .where(eq(student.id, studentId))
        .limit(1);

      if (!owned) {
        throw new ValidationError(
          "Cet élève n'appartient pas à ce foyer.",
          "notInThisSchool",
        );
      }

      /** Verrouille le cours : à partir d'ici, le décompte ne peut plus bouger. */
      const seats = await lockKlassAndCountSeats(
        tx,
        context.organizationId,
        klassId,
      );

      /**
       * Le double-tap d'un pouce sur un réseau capricieux ne doit pas produire
       * une erreur technique, mais le message qui explique la situation.
       */
      if (
        await hasLiveEnrollment(
          tx,
          context.organizationId,
          klassId,
          studentId,
        )
      ) {
        throw new ValidationError(
          "Cet élève a déjà une inscription en cours sur ce cours.",
          "alreadyEnrolled",
        );
      }

      const [school] = await tx
        .select({ timezone: organization.timezone })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!school) {
        throw new ValidationError("École introuvable.", "notInThisSchool");
      }

      /** Le jour de l'école, pas celui du serveur qui enregistre. */
      const today = todayInTimeZone(school.timezone);

      await tx.insert(enrollment).values({
        organizationId: context.organizationId,
        klassId,
        studentId,
        status: seats.hasSeat ? "active" : "waitlisted",
        startDate: seats.hasSeat ? today : null,
        waitlistedAt: seats.hasSeat ? null : new Date(),
        enrolledByGuardianId: context.guardianId,
      });
    },
  ).then((result) => {
    revalidatePath(`/[locale]${routes.portal}`, "page");
    revalidatePath(`/[locale]${routes.schedule}`, "page");
    revalidatePath(`/[locale]${routes.dashboard}`, "page");
    return result;
  });
}
