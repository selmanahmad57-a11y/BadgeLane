import "server-only";

import { count, eq } from "drizzle-orm";

import { clientEnv } from "@/config/env.client";
import { serverEnv } from "@/config/env.server";
import { ORGANIZATION_CREATOR_ROLE, resolveStaffRole } from "@/config/roles";

import { organization, staffUser, type Organization, type StaffUser } from "./schema";
import { withTenant } from "./tenant";

/**
 * Synchronisation Clerk -> Postgres.
 *
 * Clerk détient les comptes et les organisations ; Postgres détient les données
 * métier. Cette fonction réconcilie les deux à la volée, au premier accès
 * authentifié, et reste idempotente.
 *
 * ⚠️ Étape Fondations. À partir du moment où l'application est déployée sur une
 * URL publique, le mécanisme robuste est le webhook Clerk
 * (`organization.created`, `organizationMembership.*`) : il capte aussi les
 * changements survenus pendant qu'aucun membre n'est connecté.
 */

export type OrganizationMembershipInput = {
  /** Identifiant d'Organization Clerk — sert aussi de clé primaire d'école. */
  organizationId: string;
  organizationName: string;
  /** Identifiant du compte Clerk (`user_…`). */
  authId: string;
  email: string;
  fullName: string | null;
  /** Rôle d'organisation renvoyé par Clerk, ex. `org:admin`. */
  clerkOrganizationRole: string | null;
};

export type OrganizationMembership = {
  organization: Organization;
  staffUser: StaffUser;
};

export async function syncOrganizationMembership(
  input: OrganizationMembershipInput,
): Promise<OrganizationMembership> {
  return withTenant(input.organizationId, async (tx) => {
    const [syncedOrganization] = await tx
      .insert(organization)
      .values({
        id: input.organizationId,
        name: input.organizationName,
        timezone: serverEnv.DEFAULT_ORGANIZATION_TIMEZONE,
        currency: serverEnv.DEFAULT_ORGANIZATION_CURRENCY,
        country: serverEnv.DEFAULT_ORGANIZATION_COUNTRY,
        /**
         * Une école neuve sert par défaut toutes les langues que l'application
         * propose ; son admin restreindra ensuite la liste dans les réglages.
         */
        supportedLanguages: [...clientEnv.NEXT_PUBLIC_SUPPORTED_LOCALES],
      })
      .onConflictDoUpdate({
        target: organization.id,
        /**
         * Seul le nom est repris de Clerk. Fuseau, devise, pays et langues
         * appartiennent à l'école dès qu'elle les a ajustés : les réécrire à
         * chaque connexion annulerait ses réglages.
         */
        set: { name: input.organizationName },
      })
      .returning();

    const [{ value: existingStaffCount }] = await tx
      .select({ value: count() })
      .from(staffUser)
      .where(eq(staffUser.organizationId, input.organizationId));

    /**
     * Clerk ne distingue pas « propriétaire » d'« administrateur ». Le premier
     * membre synchronisé d'une école en est le créateur : il reçoit le rôle le
     * plus élevé, les suivants héritent de la correspondance Clerk.
     */
    const initialRole =
      existingStaffCount === 0
        ? ORGANIZATION_CREATOR_ROLE
        : resolveStaffRole(input.clerkOrganizationRole);

    const [syncedStaffUser] = await tx
      .insert(staffUser)
      .values({
        organizationId: input.organizationId,
        authId: input.authId,
        email: input.email,
        fullName: input.fullName,
        role: initialRole,
      })
      .onConflictDoUpdate({
        target: [staffUser.organizationId, staffUser.authId],
        /**
         * Le rôle n'est volontairement pas mis à jour : après la création, il
         * est modifié depuis les réglages BadgeLane et ne doit pas être écrasé
         * par la valeur Clerk à chaque connexion.
         */
        set: { email: input.email, fullName: input.fullName },
      })
      .returning();

    return { organization: syncedOrganization, staffUser: syncedStaffUser };
  });
}
