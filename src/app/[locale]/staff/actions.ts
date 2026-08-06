"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import {
  INVITABLE_STAFF_ROLES,
  STAFF_ROLES,
  STAFF_ROLE_TO_CLERK_ROLE,
  type StaffRole,
} from "@/config/roles";
import { FIELD_LIMITS } from "@/config/validation";
import { staffUser } from "@/db/schema";
import { withTenant, type TenantTransaction } from "@/db/tenant";
import type { ActionResult } from "@/lib/action-result";
import {
  requiredEnum,
  requiredText,
  requiredUuid,
  runAuthorizedAction,
  ValidationError,
} from "@/lib/actions";

/**
 * Gestion du personnel : invitations, rôles, désactivation.
 *
 * Deux systèmes se répondent — Clerk détient les comptes et les invitations,
 * BadgeLane détient les rôles métier. Le rôle stocké en base fait autorité :
 * c'est lui que consultent les contrôles d'autorisation, jamais le jeton Clerk.
 */

const STAFF_PATH = `/[locale]${routes.staff}`;

function revalidateStaff() {
  revalidatePath(STAFF_PATH, "page");
}

/** Adresse e-mail plausible. La validation réelle, c'est la réception du message. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Empêche qu'une école se retrouve sans propriétaire.
 *
 * Sans ce garde-fou, rétrograder ou désactiver le dernier `owner` laisserait
 * l'école sans personne pouvant gérer le personnel — état dont on ne sort pas
 * depuis l'application.
 */
async function assertNotLastOwner(
  tx: TenantTransaction,
  organizationId: string,
  target: { id: string; role: StaffRole },
): Promise<void> {
  if (target.role !== "owner") return;

  const [row] = await tx
    .select({ total: count() })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.organizationId, organizationId),
        eq(staffUser.role, "owner"),
        eq(staffUser.active, true),
      ),
    );

  if ((row?.total ?? 0) <= 1) {
    throw new ValidationError(
      "Cette école n'aurait plus aucun propriétaire actif.",
      "lastOwner",
    );
  }
}

/** Charge le membre visé, en refusant qu'il s'agisse de l'auteur de l'action. */
async function loadTargetMember(
  tx: TenantTransaction,
  organizationId: string,
  staffUserId: string,
  actorStaffUserId: string,
) {
  if (staffUserId === actorStaffUserId) {
    /**
     * Se rétrograder ou se désactiver soi-même est le moyen le plus simple de
     * se verrouiller dehors. L'opération reste possible, mais par un autre
     * membre — jamais par mégarde sur sa propre ligne.
     */
    throw new ValidationError(
      "Un membre ne peut pas modifier son propre accès.",
      "cannotEditSelf",
    );
  }

  const [member] = await tx
    .select({
      id: staffUser.id,
      role: staffUser.role,
      authId: staffUser.authId,
    })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.id, staffUserId),
        eq(staffUser.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!member) {
    throw new ValidationError(
      "Ce membre n'existe pas dans cette école.",
      "notInThisSchool",
    );
  }

  return member;
}

/**
 * Invite une adresse e-mail à rejoindre l'école.
 *
 * Aucune ligne `staff_user` n'est créée maintenant : le compte Clerk n'existe
 * peut-être pas encore. Elle le sera à la première connexion de la personne,
 * par `syncOrganizationMembership()`, qui traduira alors son rôle Clerk en rôle
 * BadgeLane.
 */
export async function inviteStaffMember(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("staff:manage", async (context) => {
    const email = requiredText(formData, "email", FIELD_LIMITS.email);
    const role = requiredEnum(formData, "role", INVITABLE_STAFF_ROLES);

    if (!EMAIL_PATTERN.test(email)) {
      throw new ValidationError(
        `Adresse « ${email} » invalide.`,
        "emailInvalid",
      );
    }

    const clerk = await clerkClient();

    try {
      await clerk.organizations.createOrganizationInvitation({
        organizationId: context.organizationId,
        emailAddress: email,
        role: STAFF_ROLE_TO_CLERK_ROLE[role],
        inviterUserId: context.authId,
      });
    } catch {
      /**
       * Clerk refuse notamment les doublons d'invitation et les adresses déjà
       * membres. Le détail de sa réponse n'est pas montré à l'utilisateur : il
       * révélerait qui appartient déjà à l'école à quiconque teste des adresses.
       */
      throw new ValidationError(
        "Clerk a refusé cette invitation (adresse déjà invitée ou déjà membre).",
        "invitationRejected",
      );
    }

    revalidateStaff();
  });
}

/** Change le rôle BadgeLane d'un membre. La base fait autorité, pas Clerk. */
export async function changeStaffRole(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("staff:manage", async (context) => {
    const staffUserId = requiredUuid(formData, "staffUserId");
    const role = requiredEnum(formData, "role", STAFF_ROLES);

    await withTenant(context.organizationId, async (tx) => {
      const member = await loadTargetMember(
        tx,
        context.organizationId,
        staffUserId,
        context.staffUserId,
      );

      if (member.role === "owner" && role !== "owner") {
        await assertNotLastOwner(tx, context.organizationId, member);
      }

      await tx
        .update(staffUser)
        .set({ role })
        .where(
          and(
            eq(staffUser.id, staffUserId),
            eq(staffUser.organizationId, context.organizationId),
          ),
        );
    });

    revalidateStaff();
  });
}

/**
 * Désactive un membre : il conserve son historique mais perd tout accès.
 *
 * Préféré à une suppression — les actions passées d'un coach (présences,
 * compétences validées) doivent rester attribuables après son départ.
 */
export async function setStaffMemberActive(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("staff:manage", async (context) => {
    const staffUserId = requiredUuid(formData, "staffUserId");
    const active = formData.get("active") === "true";

    await withTenant(context.organizationId, async (tx) => {
      const member = await loadTargetMember(
        tx,
        context.organizationId,
        staffUserId,
        context.staffUserId,
      );

      if (!active) {
        await assertNotLastOwner(tx, context.organizationId, member);
      }

      await tx
        .update(staffUser)
        .set({ active })
        .where(
          and(
            eq(staffUser.id, staffUserId),
            eq(staffUser.organizationId, context.organizationId),
          ),
        );
    });

    revalidateStaff();
  });
}
