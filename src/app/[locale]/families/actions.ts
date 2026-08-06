"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { familyPath, routes } from "@/config/routes";
import { FIELD_LIMITS } from "@/config/validation";
import { family, guardian, level, student } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assertBelongsToTenant } from "@/db/tenant-guard";
import type { ActionResult } from "@/lib/action-result";
import {
  optionalText,
  optionalUuid,
  requiredBirthDate,
  requiredLocale,
  requiredText,
  requiredUuid,
  runAuthorizedAction,
} from "@/lib/actions";

/**
 * Écritures sur les familles, tuteurs et élèves.
 *
 * Ces tables portent des noms d'enfants, des dates de naissance et des notes de
 * santé. Chaque écriture passe par `runAuthorizedAction("family:write", …)`,
 * qui refuse le rôle coach, et chaque clé étrangère est vérifiée par une
 * lecture soumise à la RLS — les contraintes Postgres, elles, ne le sont pas.
 */

const FAMILIES_PATH = `/[locale]${routes.families}`;

/**
 * Revalide la liste et, le cas échéant, la fiche concernée.
 *
 * Le segment de langue reste générique : les deux langues sont revalidées
 * ensemble, sinon un ajout fait en anglais resterait invisible en espagnol.
 */
function revalidateFamilies(familyId?: string) {
  revalidatePath(FAMILIES_PATH, "page");
  if (familyId) {
    revalidatePath(`/[locale]${familyPath(familyId)}`, "page");
  }
}

// ─── Familles ────────────────────────────────────────────────────────────────

export async function createFamily(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const primaryGuardianName = requiredText(
      formData,
      "primaryGuardianName",
      FIELD_LIMITS.name,
    );
    const email = requiredText(formData, "email", FIELD_LIMITS.email);
    const phone = optionalText(formData, "phone", FIELD_LIMITS.phone);
    const preferredLanguage = requiredLocale(formData, "preferredLanguage");

    await withTenant(context.organizationId, (tx) =>
      tx.insert(family).values({
        organizationId: context.organizationId,
        primaryGuardianName,
        email,
        phone,
        preferredLanguage,
      }),
    );

    revalidateFamilies();
  });
}

export async function updateFamily(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const familyId = requiredUuid(formData, "familyId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(family)
        .set({
          primaryGuardianName: requiredText(
            formData,
            "primaryGuardianName",
            FIELD_LIMITS.name,
          ),
          email: requiredText(formData, "email", FIELD_LIMITS.email),
          phone: optionalText(formData, "phone", FIELD_LIMITS.phone),
          preferredLanguage: requiredLocale(formData, "preferredLanguage"),
        })
        .where(
          and(
            eq(family.id, familyId),
            eq(family.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateFamilies(familyId);
  });
}

/** Supprime la famille, ses tuteurs et ses élèves — cascade déclarée au schéma. */
export async function deleteFamily(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const familyId = requiredUuid(formData, "familyId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(family)
        .where(
          and(
            eq(family.id, familyId),
            eq(family.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateFamilies(familyId);
  });
}

// ─── Tuteurs ─────────────────────────────────────────────────────────────────

export async function createGuardian(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const familyId = requiredUuid(formData, "familyId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const email = optionalText(formData, "email", FIELD_LIMITS.email);
    const phone = optionalText(formData, "phone", FIELD_LIMITS.phone);
    const preferredLanguage = requiredLocale(formData, "preferredLanguage");

    await withTenant(context.organizationId, async (tx) => {
      await assertBelongsToTenant(
        tx,
        family,
        "family",
        familyId,
        context.organizationId,
      );

      await tx.insert(guardian).values({
        organizationId: context.organizationId,
        familyId,
        name,
        email,
        phone,
        preferredLanguage,
      });
    });

    revalidateFamilies(familyId);
  });
}

export async function updateGuardian(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const guardianId = requiredUuid(formData, "guardianId");
    const familyId = requiredUuid(formData, "familyId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(guardian)
        .set({
          name: requiredText(formData, "name", FIELD_LIMITS.name),
          email: optionalText(formData, "email", FIELD_LIMITS.email),
          phone: optionalText(formData, "phone", FIELD_LIMITS.phone),
          preferredLanguage: requiredLocale(formData, "preferredLanguage"),
        })
        .where(
          and(
            eq(guardian.id, guardianId),
            eq(guardian.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateFamilies(familyId);
  });
}

export async function deleteGuardian(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const guardianId = requiredUuid(formData, "guardianId");
    const familyId = requiredUuid(formData, "familyId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(guardian)
        .where(
          and(
            eq(guardian.id, guardianId),
            eq(guardian.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateFamilies(familyId);
  });
}

// ─── Élèves ──────────────────────────────────────────────────────────────────

export async function createStudent(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const familyId = requiredUuid(formData, "familyId");
    const firstName = requiredText(formData, "firstName", FIELD_LIMITS.name);
    const lastName = requiredText(formData, "lastName", FIELD_LIMITS.name);
    const dateOfBirth = requiredBirthDate(formData, "dateOfBirth");

    await withTenant(context.organizationId, async (tx) => {
      await assertBelongsToTenant(
        tx,
        family,
        "family",
        familyId,
        context.organizationId,
      );

      await tx.insert(student).values({
        organizationId: context.organizationId,
        familyId,
        firstName,
        lastName,
        dateOfBirth,
      });
    });

    revalidateFamilies(familyId);
  });
}

/**
 * Met à jour une fiche élève, niveau courant compris.
 *
 * C'est ici que se joue le contrôle le plus important de la semaine :
 * `currentLevelId` arrive d'un formulaire, donc du navigateur. La contrainte de
 * clé étrangère accepterait le niveau d'une école concurrente — Postgres ne lui
 * applique pas les politiques RLS. Seule la lecture faite par
 * `assertBelongsToTenant` le refuse.
 */
export async function updateStudent(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const studentId = requiredUuid(formData, "studentId");
    const familyId = requiredUuid(formData, "familyId");
    const firstName = requiredText(formData, "firstName", FIELD_LIMITS.name);
    const lastName = requiredText(formData, "lastName", FIELD_LIMITS.name);
    const dateOfBirth = requiredBirthDate(formData, "dateOfBirth");
    const currentLevelId = optionalUuid(formData, "currentLevelId");
    const medicalNotes = optionalText(
      formData,
      "medicalNotes",
      FIELD_LIMITS.medicalNotes,
    );

    await withTenant(context.organizationId, async (tx) => {
      if (currentLevelId) {
        await assertBelongsToTenant(
          tx,
          level,
          "level",
          currentLevelId,
          context.organizationId,
        );
      }

      await tx
        .update(student)
        .set({
          firstName,
          lastName,
          dateOfBirth,
          currentLevelId,
          medicalNotes,
        })
        .where(
          and(
            eq(student.id, studentId),
            eq(student.organizationId, context.organizationId),
          ),
        );
    });

    revalidateFamilies(familyId);
  });
}

export async function deleteStudent(formData: FormData): Promise<ActionResult> {
  return runAuthorizedAction("family:write", async (context) => {
    const studentId = requiredUuid(formData, "studentId");
    const familyId = requiredUuid(formData, "familyId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(student)
        .where(
          and(
            eq(student.id, studentId),
            eq(student.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateFamilies(familyId);
  });
}
