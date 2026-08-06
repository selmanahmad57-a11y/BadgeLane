import "server-only";

import { sql } from "drizzle-orm";

import {
  TENANT_CONTEXT_IS_TRANSACTION_LOCAL,
  TENANT_CONTEXT_SETTING,
} from "@/config/database";

import { db } from "./client";

/**
 * Isolation multi-tenant (§7 du blueprint, priorité n°1).
 *
 * Deux barrières superposées :
 *  1. cette couche, qui n'expose aucun moyen de requêter sans nommer une école ;
 *  2. les politiques RLS Postgres, qui filtrent même si la couche 1 est
 *     contournée par erreur.
 *
 * La seconde est la vraie garantie : un `where organizationId = …` oublié ne
 * fuite rien, il ne renvoie simplement rien. `src/db/isolation.ts` vérifie
 * qu'elle est bien en place.
 */

export type TenantTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Exécute `run` dans une transaction où l'organisation courante est posée.
 *
 * `set_config(..., is_local => true)` limite la portée du paramètre à la
 * transaction : la connexion rendue au pool n'en conserve aucune trace, ce qui
 * empêche une requête ultérieure d'hériter du contexte d'une autre école.
 */
export async function withTenant<T>(
  organizationId: string,
  run: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    throw new Error(
      "withTenant() a été appelé sans identifiant d'organisation : la requête aurait été exécutée hors de tout contexte de tenant.",
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}, ${TENANT_CONTEXT_IS_TRANSACTION_LOCAL})`,
    );

    return run(tx);
  });
}
