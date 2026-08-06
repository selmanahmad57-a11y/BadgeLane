/**
 * Rôles du personnel d'une école, tels que définis au §3 du blueprint.
 *
 * Source unique : cette liste alimente l'enum Postgres, les contrôles
 * d'autorisation serveur et l'interface. Ajouter un rôle ici et générer une
 * migration suffit — aucune chaîne de rôle n'est écrite ailleurs.
 */
export const STAFF_ROLES = ["owner", "admin", "coach"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Correspondance entre les rôles d'organisation Clerk et les rôles BadgeLane.
 *
 * Clerk livre deux rôles d'organisation par défaut (`org:admin`, `org:member`).
 * Le rôle faisant autorité côté produit reste celui stocké en base : cette
 * table ne sert qu'à initialiser un membre lors de sa première synchronisation.
 *
 * ⚠️ À revoir si tu configures des rôles personnalisés dans le dashboard Clerk :
 * il suffira d'ajouter les clés correspondantes ici.
 */
export const CLERK_ROLE_TO_STAFF_ROLE: Readonly<Record<string, StaffRole>> = {
  "org:admin": "admin",
  "org:member": "coach",
};

/**
 * Rôle attribué quand le rôle Clerk n'est pas reconnu : le moins privilégié.
 * Une élévation de privilège doit toujours être un acte explicite.
 */
export const FALLBACK_STAFF_ROLE: StaffRole = "coach";

/**
 * Rôle attribué au créateur de l'organisation. Clerk ne distingue pas
 * « propriétaire » de « administrateur » ; BadgeLane, si (§4-A, réglages staff).
 */
export const ORGANIZATION_CREATOR_ROLE: StaffRole = "owner";

export function resolveStaffRole(clerkOrganizationRole: string | null | undefined): StaffRole {
  if (!clerkOrganizationRole) return FALLBACK_STAFF_ROLE;
  return CLERK_ROLE_TO_STAFF_ROLE[clerkOrganizationRole] ?? FALLBACK_STAFF_ROLE;
}
