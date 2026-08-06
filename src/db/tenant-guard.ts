import { and, eq, type SQL } from "drizzle-orm";

/**
 * Vérification d'appartenance d'une ligne parente à l'école courante.
 *
 * ── Pourquoi ce module existe ────────────────────────────────────────────────
 *
 * Postgres vérifie les contraintes de clé étrangère **sans appliquer les
 * politiques de sécurité au niveau ligne**. Une insertion référençant la ligne
 * d'une autre école est donc acceptée par la base : la RLS masque la ligne à la
 * lecture, mais ne l'empêche pas d'être référencée.
 *
 * Concrètement, sans cette garde, rien n'empêcherait d'affecter à un élève un
 * niveau appartenant à une école concurrente — il suffirait d'en connaître
 * l'identifiant, ou de le deviner.
 *
 * Seule une **lecture**, elle soumise à la RLS, ferme la brèche. C'est ce que
 * fait `assertBelongsToTenant`.
 *
 * ── Pourquoi il n'est pas marqué `server-only` ───────────────────────────────
 *
 * Pour que `npm run db:verify` puisse appeler cette fonction pour de vrai,
 * hors de Next.js, et prouver qu'elle refuse effectivement une référence
 * inter-écoles. Une garde jamais éprouvée n'est qu'une intention.
 */

/** Table portant un identifiant et une colonne d'organisation. */
type TenantScopedTable = {
  id: unknown;
  organizationId: unknown;
};

/** Sous-ensemble de l'API Drizzle nécessaire à la vérification. */
type SelectCapable = {
  select: (fields: Record<string, unknown>) => {
    from: (table: never) => {
      where: (condition: SQL | undefined) => {
        limit: (count: number) => Promise<unknown[]>;
      };
    };
  };
};

/** Levée quand la ligne parente n'appartient pas à l'école courante. */
export class CrossTenantReferenceError extends Error {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(
      `La ligne « ${id} » de la table « ${table} » n'appartient pas à l'école courante.`,
    );
    this.name = "CrossTenantReferenceError";
  }
}

/**
 * Vérifie qu'une ligne parente est visible depuis le contexte de tenant courant.
 *
 * À appeler **avant** toute insertion ou mise à jour portant une clé étrangère
 * vers une autre table métier. La transaction fournie doit déjà avoir son
 * contexte posé par `withTenant()` — sans quoi la lecture ne renvoie rien et la
 * vérification échoue, ce qui est le comportement sûr.
 */
export async function assertBelongsToTenant(
  tx: SelectCapable,
  table: TenantScopedTable,
  tableName: string,
  id: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: table.id })
    .from(table as never)
    .where(
      and(
        eq(table.id as never, id),
        eq(table.organizationId as never, organizationId),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new CrossTenantReferenceError(tableName, id);
  }
}
