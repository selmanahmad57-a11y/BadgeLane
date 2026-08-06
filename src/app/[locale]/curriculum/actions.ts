"use server";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import {
  COLOR_PATTERN,
  FIELD_LIMITS,
  SORT_ORDER_STEP,
} from "@/config/validation";
import { countClassesUsing } from "@/db/queries";
import { level, program, skill } from "@/db/schema";
import { withTenant, type TenantTransaction } from "@/db/tenant";
import { assertBelongsToTenant } from "@/db/tenant-guard";
import type { ActionResult } from "@/lib/action-result";
import {
  optionalText,
  requiredText,
  requiredUuid,
  runAuthorizedAction,
  ValidationError,
} from "@/lib/actions";

/**
 * Écritures du curriculum : programmes, niveaux, compétences.
 *
 * Chacune passe par `runAuthorizedAction("curriculum:write", …)`, qui refuse
 * l'accès au rôle coach. Ce contrôle est la protection réelle ; masquer les
 * boutons dans l'interface n'en est que le reflet.
 */

/** Le segment de langue est générique : toutes les langues sont revalidées. */
const CURRICULUM_PATH = `/[locale]${routes.curriculum}`;

function revalidateCurriculum() {
  revalidatePath(CURRICULUM_PATH, "page");
}

/** Position suivante dans une liste, calculée depuis le maximum en base. */
async function nextSortOrder(
  tx: TenantTransaction,
  table: typeof level | typeof skill,
  parentColumn: typeof level.programId | typeof skill.levelId,
  parentId: string,
): Promise<number> {
  const [row] = await tx
    .select({ highest: max(table.sortOrder) })
    .from(table)
    .where(eq(parentColumn, parentId));

  return (row?.highest ?? 0) + SORT_ORDER_STEP;
}

function requiredColor(formData: FormData): string {
  const value = requiredText(formData, "color", FIELD_LIMITS.name);

  if (!COLOR_PATTERN.test(value)) {
    throw new ValidationError(`Couleur « ${value} » invalide.`);
  }

  return value;
}

// ─── Programmes ──────────────────────────────────────────────────────────────

export async function createProgram(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const description = optionalText(
      formData,
      "description",
      FIELD_LIMITS.description,
    );

    await withTenant(context.organizationId, (tx) =>
      tx.insert(program).values({
        organizationId: context.organizationId,
        name,
        description,
      }),
    );

    revalidateCurriculum();
  });
}

export async function updateProgram(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const programId = requiredUuid(formData, "programId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(program)
        .set({ name })
        .where(
          and(
            eq(program.id, programId),
            eq(program.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateCurriculum();
  });
}

export async function deleteProgram(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const programId = requiredUuid(formData, "programId");

    /**
     * Un programme encore au planning ne se supprime pas.
     *
     * La clé étrangère `klass.program_id` est en `ON DELETE restrict` : sans ce
     * contrôle, Postgres refuserait de lui-même, mais par une violation de
     * contrainte illisible. Mieux vaut un refus expliqué qu'une erreur brute.
     */
    if (
      (await countClassesUsing(context.organizationId, { programId })) > 0
    ) {
      throw new ValidationError(
        "Ce programme est utilisé par des cours au planning.",
      );
    }

    /** Les niveaux et compétences suivent, par cascade déclarée au schéma. */
    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(program)
        .where(
          and(
            eq(program.id, programId),
            eq(program.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateCurriculum();
  });
}

// ─── Niveaux ─────────────────────────────────────────────────────────────────

export async function createLevel(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const programId = requiredUuid(formData, "programId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const color = requiredColor(formData);

    await withTenant(context.organizationId, async (tx) => {
      await assertBelongsToTenant(
        tx,
        program,
        "program",
        programId,
        context.organizationId,
      );

      await tx.insert(level).values({
        organizationId: context.organizationId,
        programId,
        name,
        color,
        sortOrder: await nextSortOrder(tx, level, level.programId, programId),
      });
    });

    revalidateCurriculum();
  });
}

export async function updateLevel(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const levelId = requiredUuid(formData, "levelId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const color = requiredColor(formData);

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(level)
        .set({ name, color })
        .where(
          and(
            eq(level.id, levelId),
            eq(level.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateCurriculum();
  });
}

export async function deleteLevel(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const levelId = requiredUuid(formData, "levelId");

    if ((await countClassesUsing(context.organizationId, { levelId })) > 0) {
      throw new ValidationError(
        "Ce niveau est utilisé par des cours au planning.",
      );
    }

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(level)
        .where(
          and(
            eq(level.id, levelId),
            eq(level.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateCurriculum();
  });
}

// ─── Compétences ─────────────────────────────────────────────────────────────

export async function createSkill(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const levelId = requiredUuid(formData, "levelId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const description = optionalText(
      formData,
      "description",
      FIELD_LIMITS.description,
    );

    await withTenant(context.organizationId, async (tx) => {
      await assertBelongsToTenant(
        tx,
        level,
        "level",
        levelId,
        context.organizationId,
      );

      await tx.insert(skill).values({
        organizationId: context.organizationId,
        levelId,
        name,
        description,
        sortOrder: await nextSortOrder(tx, skill, skill.levelId, levelId),
      });
    });

    revalidateCurriculum();
  });
}

export async function updateSkill(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const skillId = requiredUuid(formData, "skillId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(skill)
        .set({ name })
        .where(
          and(
            eq(skill.id, skillId),
            eq(skill.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateCurriculum();
  });
}

export async function deleteSkill(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("curriculum:write", async (context) => {
    const skillId = requiredUuid(formData, "skillId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(skill)
        .where(
          and(
            eq(skill.id, skillId),
            eq(skill.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateCurriculum();
  });
}
