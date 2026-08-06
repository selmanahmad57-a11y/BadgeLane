import "server-only";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { Locale } from "@/config/i18n";
import { localizedPath, routes } from "@/config/routes";
import {
  syncOrganizationMembership,
  type OrganizationMembership,
} from "@/db/sync";

/**
 * Pont entre la session Clerk et le contexte de tenant de l'application.
 *
 * Toute page servant des données d'école passe par ici : c'est le seul endroit
 * qui produit un `organizationId` digne de confiance, celui de la session
 * vérifiée — jamais un identifiant lu dans l'URL ou dans un formulaire.
 */

export type OrganizationSession = OrganizationMembership & {
  authId: string;
  email: string;
  fullName: string | null;
};

/**
 * Exige un utilisateur connecté *et* une école sélectionnée, puis réconcilie
 * l'état Clerk avec Postgres.
 *
 * Redirige plutôt que de lever : appelée depuis un composant serveur, elle doit
 * pouvoir amener le visiteur à l'étape manquante.
 */
export async function requireOrganizationSession(
  locale: Locale,
): Promise<OrganizationSession> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    redirect(localizedPath(locale, routes.signIn));
  }

  if (!orgId) {
    redirect(localizedPath(locale, routes.createOrganization));
  }

  const [user, clerk] = await Promise.all([currentUser(), clerkClient()]);

  if (!user) {
    redirect(localizedPath(locale, routes.signIn));
  }

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;

  if (!email) {
    throw new Error(
      `Le compte Clerk ${userId} n'expose aucune adresse e-mail ; BadgeLane en exige une pour rattacher un membre du personnel à une école.`,
    );
  }

  const organization = await clerk.organizations.getOrganization({
    organizationId: orgId,
  });

  const membership = await syncOrganizationMembership({
    organizationId: orgId,
    organizationName: organization.name,
    authId: userId,
    email,
    fullName: user.fullName,
    clerkOrganizationRole: orgRole ?? null,
  });

  return { ...membership, authId: userId, email, fullName: user.fullName };
}
