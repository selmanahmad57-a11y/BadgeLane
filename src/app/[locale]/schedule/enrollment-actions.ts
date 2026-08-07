"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import {
  hasLiveEnrollment,
  lockKlassAndCountSeats,
} from "@/db/enrollment";
import { enrollment, organization, student } from "@/db/schema";
import { withTenant, type TenantTransaction } from "@/db/tenant";
import { assertBelongsToTenant } from "@/db/tenant-guard";
import type { ActionResult } from "@/lib/action-result";
import {
  requiredUuid,
  runAuthorizedAction,
  ValidationError,
} from "@/lib/actions";
import { todayInTimeZone } from "@/lib/occurrences";

/**
 * Inscriptions : ajouter, promouvoir depuis l'attente, clore.
 *
 * Les trois se disputent la même ressource — une place dans un cours — et
 * passent donc toutes par le verrou de `lockKlassAndCountSeats`. Sans quoi
 * deux validations simultanées feraient entrer neuf enfants dans un bassin qui
 * en accepte huit ; `npm run enrollment:verify` le démontre, avec et sans.
 */

const SCHEDULE_PATH = `/[locale]${routes.schedule}`;

function revalidateEnrolment() {
  revalidatePath(SCHEDULE_PATH, "page");
  revalidatePath(`/[locale]${routes.families}`, "page");
}

/**
 * Date du jour dans le fuseau de l'école.
 *
 * Le début d'une inscription est un fait de la vie de l'école, pas du serveur
 * qui l'enregistre : à 20 h à Los Angeles, on est déjà demain à New York.
 */
async function schoolToday(
  tx: TenantTransaction,
  organizationId: string,
): Promise<string> {
  const [row] = await tx
    .select({ timezone: organization.timezone })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!row) {
    throw new ValidationError("École introuvable.");
  }

  return todayInTimeZone(row.timezone);
}

/**
 * Inscrit un élève, ou le place en liste d'attente si le cours est complet.
 *
 * Le choix entre les deux n'est pas laissé à l'appelant : il découle du
 * décompte fait sous verrou. Une interface ne peut donc pas « forcer » une
 * inscription dans un cours plein, même en modifiant le formulaire.
 */
export async function enrollStudent(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const klassId = requiredUuid(formData, "klassId");
    const studentId = requiredUuid(formData, "studentId");

    await withTenant(context.organizationId, async (tx) => {
      await assertBelongsToTenant(
        tx,
        student,
        "student",
        studentId,
        context.organizationId,
      );

      /** Verrouille le cours : le décompte qui suit ne peut plus bouger. */
      const seats = await lockKlassAndCountSeats(
        tx,
        context.organizationId,
        klassId,
      );

      if (
        await hasLiveEnrollment(tx, context.organizationId, klassId, studentId)
      ) {
        throw new ValidationError(
          "Cet élève a déjà une inscription en cours sur ce cours.",
          "alreadyEnrolled",
        );
      }

      const today = await schoolToday(tx, context.organizationId);

      await tx.insert(enrollment).values({
        organizationId: context.organizationId,
        klassId,
        studentId,
        status: seats.hasSeat ? "active" : "waitlisted",
        /** Le début n'existe que si l'élève entre réellement dans le cours. */
        startDate: seats.hasSeat ? today : null,
        waitlistedAt: seats.hasSeat ? null : new Date(),
      });
    });

    revalidateEnrolment();
  });
}

/**
 * Fait entrer un élève depuis la liste d'attente.
 *
 * Sous le même verrou que l'inscription : entre le moment où l'écran affiche
 * « une place libre » et celui où l'on valide, quelqu'un d'autre a pu la
 * prendre. La capacité est donc revérifiée, jamais supposée.
 */
export async function promoteEnrollment(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const enrollmentId = requiredUuid(formData, "enrollmentId");

    await withTenant(context.organizationId, async (tx) => {
      const [target] = await tx
        .select({ klassId: enrollment.klassId, status: enrollment.status })
        .from(enrollment)
        .where(
          and(
            eq(enrollment.id, enrollmentId),
            eq(enrollment.organizationId, context.organizationId),
          ),
        )
        .limit(1);

      if (!target) {
        throw new ValidationError(
          "Cette inscription n'existe pas.",
          "notInThisSchool",
        );
      }

      if (target.status !== "waitlisted") {
        throw new ValidationError(
          "Cette inscription n'est pas en attente.",
          "notWaitlisted",
        );
      }

      const seats = await lockKlassAndCountSeats(
        tx,
        context.organizationId,
        target.klassId,
      );

      if (!seats.hasSeat) {
        throw new ValidationError(
          `Ce cours est complet (${seats.taken}/${seats.capacity}).`,
          "classFull",
          { taken: seats.taken, capacity: seats.capacity },
        );
      }

      await tx
        .update(enrollment)
        .set({
          status: "active",
          waitlistedAt: null,
          startDate: await schoolToday(tx, context.organizationId),
        })
        .where(eq(enrollment.id, enrollmentId));
    });

    revalidateEnrolment();
  });
}

/**
 * Clôt une inscription et libère la place.
 *
 * Aucun verrou nécessaire : libérer une place ne peut pas dépasser la capacité.
 * `end_date` est posée maintenant, au moment où l'information se sait — jamais
 * reconstruite après coup.
 */
export async function endEnrollment(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const enrollmentId = requiredUuid(formData, "enrollmentId");

    await withTenant(context.organizationId, async (tx) => {
      await tx
        .update(enrollment)
        .set({
          status: "ended",
          endDate: await schoolToday(tx, context.organizationId),
          waitlistedAt: null,
        })
        .where(
          and(
            eq(enrollment.id, enrollmentId),
            eq(enrollment.organizationId, context.organizationId),
          ),
        );
    });

    revalidateEnrolment();
  });
}

/**
 * Marque une inscription comme relue par l'école.
 *
 * ── Pourquoi cette action existe ─────────────────────────────────────────────
 *
 * Elle ne change rien à l'inscription elle-même : elle vide une ligne de la
 * file de revue. C'est ce qui distingue une **file** d'un flux qui vieillit —
 * on en sort par un geste, jamais par le passage du temps.
 *
 * Le geste appartient au personnel, sous la même capacité que le retrait :
 * décider qu'une inscription est acceptable et décider de l'annuler sont deux
 * faces du même pouvoir, et il n'a jamais été accordé au parent.
 */
export async function markEnrollmentReviewed(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("schedule:write", async (context) => {
    const enrollmentId = requiredUuid(formData, "enrollmentId");

    await withTenant(context.organizationId, async (tx) => {
      await tx
        .update(enrollment)
        .set({ reviewedAt: new Date() })
        .where(
          and(
            eq(enrollment.id, enrollmentId),
            eq(enrollment.organizationId, context.organizationId),
          ),
        );
    });

    revalidateEnrolment();
    revalidatePath(`/[locale]${routes.dashboard}`, "page");
  });
}
