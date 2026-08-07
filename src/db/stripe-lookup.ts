import { sql } from "drizzle-orm";

/**
 * Résolution d'un compte Stripe vers une école — le seul chemin qui échappe à
 * la RLS, et la seule façon pour un webhook de savoir de qui il parle.
 *
 * ── Pourquoi cette exception existe ──────────────────────────────────────────
 *
 * Depuis la Semaine 1, toute écriture tient son `organizationId` d'une session
 * Clerk vérifiée. Un webhook n'a pas de session. Lire
 * `organization.stripe_account_id` demanderait un contexte de tenant… qu'on
 * cherche justement à établir.
 *
 * ── Pourquoi elle est acceptable ─────────────────────────────────────────────
 *
 *  * la vue n'expose que deux identifiants opaques, aucune donnée d'école ;
 *  * `npm run db:verify` échoue si elle en expose davantage ;
 *  * elle n'est atteinte qu'**après** une vérification de signature réussie —
 *    à cet instant, la charge utile a déjà prouvé qu'elle vient de Stripe.
 *
 * Vérifié : hors contexte de tenant, cette vue renvoie la correspondance tandis
 * que `organization` reste à zéro ligne. L'exception est étroite, pas ouverte.
 */
export async function resolveOrganizationForAccount(
  executor: { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> },
  stripeAccountId: string,
): Promise<string | null> {
  const { rows } = await executor.execute(sql`
    select organization_id
    from stripe_account_lookup
    where stripe_account_id = ${stripeAccountId}
    limit 1
  `);

  const row = rows[0] as { organization_id?: string } | undefined;
  return row?.organization_id ?? null;
}
