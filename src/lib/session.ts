import "server-only";

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import type { StaffRole } from "@/config/roles";
import { staffUser } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * Contexte du membre du personnel connecté, tel qu'il fait autorité côté
 * serveur.
 *
 * Deux sources, aucune venant du client :
 *  - l'école et le compte proviennent de la session Clerk vérifiée ;
 *  - le rôle provient de la base, pas du jeton Clerk. C'est BadgeLane qui
 *    décide qui est owner, admin ou coach (§4-A), pas le fournisseur d'identité.
 */
export type StaffContext = {
  organizationId: string;
  /** Identifiant du compte Clerk. */
  authId: string;
  /** Identifiant de la ligne `staff_user`, propre à cette école. */
  staffUserId: string;
  role: StaffRole;
};

/**
 * Erreur levée lorsqu'aucune session exploitable n'est disponible.
 * Distincte d'un refus d'autorisation : ici il n'y a pas d'identité du tout.
 */
export class UnauthenticatedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Résout le contexte du membre connecté, ou lève.
 *
 * Destinée aux actions serveur, qui doivent échouer plutôt que rediriger : une
 * action déclenchée sans droits est une anomalie à signaler, pas un parcours de
 * navigation à corriger.
 *
 * Ne fait aucun appel à l'API Clerk — l'école et le compte sont lus dans la
 * session, le rôle dans une unique requête déjà filtrée par la RLS.
 */
export async function requireStaffContext(): Promise<StaffContext> {
  const { userId, orgId } = await auth();

  if (!userId) {
    throw new UnauthenticatedError("Aucun utilisateur connecté.");
  }

  if (!orgId) {
    throw new UnauthenticatedError("Aucune école sélectionnée.");
  }

  const member = await withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({ id: staffUser.id, role: staffUser.role })
      .from(staffUser)
      .where(
        and(eq(staffUser.authId, userId), eq(staffUser.active, true)),
      )
      .limit(1);

    return row;
  });

  if (!member) {
    /**
     * Le compte est authentifié et une école est sélectionnée, mais aucun
     * membre actif ne correspond dans cette école. Cas d'un membre désactivé,
     * ou d'une école dont la synchronisation n'a jamais eu lieu.
     */
    throw new UnauthenticatedError(
      "Le compte connecté n'est pas un membre actif de cette école.",
    );
  }

  return {
    organizationId: orgId,
    authId: userId,
    staffUserId: member.id,
    role: member.role,
  };
}
