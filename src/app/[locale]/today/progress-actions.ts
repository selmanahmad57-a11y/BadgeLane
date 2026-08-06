"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { PROGRESS_STATUSES, type ProgressStatus } from "@/config/progress";
import { routes } from "@/config/routes";
import { skill, skillProgress, student } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { ActionResult } from "@/lib/action-result";
import { runAuthorizedAction, ValidationError } from "@/lib/actions";

/**
 * Validation des compétences.
 *
 * Comme la présence, reçoit un **lot** et procède par `upsert` sur la
 * contrainte d'unicité (école, élève, compétence). C'est ce qui rend le rejeu
 * de la file sûr : renvoyer deux fois le même lot produit le même état.
 *
 * `achieved_at` et `coach_id` viennent du serveur, jamais du navigateur — même
 * règle que `marked_by` pour la présence.
 */

export type ProgressEntry = {
  studentId: string;
  skillId: string;
  /** `null` retire la marque : la compétence redevient « pas commencée ». */
  status: ProgressStatus | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEntries(raw: unknown): ProgressEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("Lot de progression vide ou mal formé.");
  }

  return raw.map((entry) => {
    const candidate = entry as Partial<ProgressEntry>;

    if (
      typeof candidate.studentId !== "string" ||
      !UUID_PATTERN.test(candidate.studentId) ||
      typeof candidate.skillId !== "string" ||
      !UUID_PATTERN.test(candidate.skillId) ||
      !(
        candidate.status === null ||
        (typeof candidate.status === "string" &&
          (PROGRESS_STATUSES as readonly string[]).includes(candidate.status))
      )
    ) {
      throw new ValidationError("Marque de progression mal formée.");
    }

    return candidate as ProgressEntry;
  });
}

export async function submitProgress(raw: unknown): Promise<ActionResult> {
  return runAuthorizedAction("progression:write", async (context) => {
    const entries = parseEntries(raw);

    await withTenant(context.organizationId, async (tx) => {
      /**
       * Élèves et compétences vérifiés en une requête chacun. Le contrôle est
       * soumis à la RLS : une compétence appartenant au curriculum d'une autre
       * école n'apparaît pas, donc n'est pas acceptée. Les contraintes de clé
       * étrangère, elles, l'auraient laissée passer.
       */
      const studentIds = [...new Set(entries.map((e) => e.studentId))];
      const skillIds = [...new Set(entries.map((e) => e.skillId))];

      const [validStudents, validSkills] = await Promise.all([
        tx
          .select({ id: student.id })
          .from(student)
          .where(
            and(
              eq(student.organizationId, context.organizationId),
              inArray(student.id, studentIds),
            ),
          ),
        tx
          .select({ id: skill.id })
          .from(skill)
          .where(
            and(
              eq(skill.organizationId, context.organizationId),
              inArray(skill.id, skillIds),
            ),
          ),
      ]);

      const knownStudents = new Set(validStudents.map((row) => row.id));
      const knownSkills = new Set(validSkills.map((row) => row.id));

      const accepted = entries.filter(
        (entry) =>
          knownStudents.has(entry.studentId) && knownSkills.has(entry.skillId),
      );

      if (accepted.length === 0) {
        throw new ValidationError(
          "Aucune marque exploitable dans ce lot.",
          "notInThisSchool",
        );
      }

      /** Retirer une marque, c'est supprimer la ligne : l'absence dit tout. */
      const cleared = accepted.filter((entry) => entry.status === null);
      const marked = accepted.filter((entry) => entry.status !== null);

      for (const entry of cleared) {
        await tx
          .delete(skillProgress)
          .where(
            and(
              eq(skillProgress.organizationId, context.organizationId),
              eq(skillProgress.studentId, entry.studentId),
              eq(skillProgress.skillId, entry.skillId),
            ),
          );
      }

      if (marked.length > 0) {
        const now = new Date();

        await tx
          .insert(skillProgress)
          .values(
            marked.map((entry) => ({
              organizationId: context.organizationId,
              studentId: entry.studentId,
              skillId: entry.skillId,
              status: entry.status as ProgressStatus,
              /** Daté seulement s'il s'agit d'une acquisition. */
              achievedAt: entry.status === "achieved" ? now : null,
              coachId: context.staffUserId,
            })),
          )
          .onConflictDoUpdate({
            target: [
              skillProgress.organizationId,
              skillProgress.studentId,
              skillProgress.skillId,
            ],
            /**
             * Une régression vers « en cours » efface la date d'acquisition :
             * elle ne décrirait plus rien de vrai.
             */
            set: {
              status: sql`excluded.status`,
              achievedAt: sql`excluded.achieved_at`,
              coachId: sql`excluded.coach_id`,
            },
          });
      }
    });

    revalidatePath(`/[locale]${routes.today}`, "page");
    revalidatePath(`/[locale]${routes.families}`, "page");
  });
}
