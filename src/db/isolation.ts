import { sql, type SQL } from "drizzle-orm";

import { TENANT_CONTEXT_SETTING } from "@/config/database";

/**
 * Audit de l'isolation multi-tenant, exécutable aussi bien depuis l'application
 * que depuis un script de vérification.
 *
 * Volontairement dépourvu de `server-only` : la garantie doit pouvoir être
 * contrôlée en CI, hors de tout runtime Next.js. C'est le point de la
 * checklist §9 « RLS testées (aucun tenant ne voit un autre) ».
 */

/** Tout client Drizzle Postgres convient — l'audit ne dépend d'aucun schéma. */
export type SqlExecutor = {
  execute: (query: SQL) => Promise<{ rows: Record<string, unknown>[] }>;
};

type TableSecurityRow = {
  tablename: string;
  rls_enabled: boolean;
  rls_forced: boolean;
};

type PolicyRow = {
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
};

export type TenantIsolationReport = {
  ok: boolean;
  problems: string[];
  checkedTables: string[];
};

/** Table technique de drizzle-kit : elle ne porte aucune donnée d'école. */
const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Contrôle trois propriétés qu'une migration oubliée ferait sauter en silence :
 *
 *  1. RLS activée sur chaque table applicative ;
 *  2. RLS **forcée** — sans quoi le rôle propriétaire des tables, qui est celui
 *     qu'utilise l'application sur Neon, contournerait toutes les politiques ;
 *  3. politiques référençant bien la clé de session posée par `withTenant()`.
 */
export async function checkTenantIsolation(
  executor: SqlExecutor,
): Promise<TenantIsolationReport> {
  const problems: string[] = [];

  /**
   * Contrôle n°0, celui qui prime sur tous les autres.
   *
   * L'attribut `BYPASSRLS` désactive purement et simplement la RLS pour le rôle
   * qui le porte — politiques et `FORCE ROW LEVEL SECURITY` compris. Le rôle
   * `neondb_owner` fourni par défaut avec un projet Neon le possède, hérité de
   * `neon_superuser`. Une application connectée avec lui lit toutes les écoles
   * alors que tout, en apparence, semble correctement configuré.
   *
   * `pg_has_role(..., 'USAGE')` couvre aussi les rôles hérités : c'est par
   * héritage que l'attribut arrive le plus souvent.
   */
  const bypassRows = await executor.execute(sql`
    select current_user::text as role_name,
           bool_or(r.rolbypassrls) as bypasses_rls
    from pg_roles r
    where pg_has_role(current_user, r.oid, 'USAGE')
    group by current_user
  `);

  const bypass = bypassRows.rows[0] as
    | { role_name: string; bypasses_rls: boolean }
    | undefined;

  if (bypass?.bypasses_rls) {
    problems.push(
      `Le rôle de connexion « ${bypass.role_name} » possède BYPASSRLS : il ignore toutes les politiques. L'application doit utiliser un rôle dédié sans cet attribut — voir « npm run db:grant ».`,
    );
  }

  const tableRows = await executor.execute(sql`
    select c.relname as tablename,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema()
      and c.relkind = 'r'
      and c.relname <> ${MIGRATIONS_TABLE}
    order by c.relname
  `);

  const policyRows = await executor.execute(sql`
    select tablename, policyname, qual::text as qual, with_check::text as with_check
    from pg_policies
    where schemaname = current_schema()
  `);

  const tables = tableRows.rows as unknown as TableSecurityRow[];
  const policies = policyRows.rows as unknown as PolicyRow[];

  if (tables.length === 0) {
    problems.push(
      "Aucune table applicative trouvée : les migrations n'ont probablement pas été appliquées.",
    );
  }

  for (const table of tables) {
    if (!table.rls_enabled) {
      problems.push(`${table.tablename} : RLS non activée.`);
    }

    if (!table.rls_forced) {
      problems.push(
        `${table.tablename} : RLS non forcée — le rôle propriétaire contournerait les politiques.`,
      );
    }

    const tablePolicies = policies.filter(
      (policy) => policy.tablename === table.tablename,
    );

    if (tablePolicies.length === 0) {
      problems.push(`${table.tablename} : aucune politique RLS définie.`);
      continue;
    }

    for (const policy of tablePolicies) {
      const expression = `${policy.qual ?? ""} ${policy.with_check ?? ""}`;

      if (!expression.includes(TENANT_CONTEXT_SETTING)) {
        problems.push(
          `${table.tablename}.${policy.policyname} : la politique ne référence pas « ${TENANT_CONTEXT_SETTING} », la clé posée par withTenant().`,
        );
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    checkedTables: tables.map((table) => table.tablename),
  };
}

/**
 * Connexion capable d'exécuter du SQL paramétré et de tenir une transaction.
 * Correspond à un client `pg` / `@neondatabase/serverless` emprunté au pool.
 */
export type QueryRunner = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Valeurs injectées dans les lignes de test, fournies par l'appelant. */
export type ProbeOrganizationDefaults = {
  timezone: string;
  currency: string;
  country: string;
  supportedLanguages: string[];
};

/**
 * Preuve fonctionnelle de l'isolation : deux écoles fictives sont créées dans
 * la même transaction, et l'on vérifie que chacune est invisible depuis le
 * contexte de l'autre.
 *
 * L'audit structurel (`checkTenantIsolation`) confirme que les politiques sont
 * déclarées ; celui-ci confirme qu'elles filtrent réellement. Une politique
 * syntaxiquement correcte mais comparant la mauvaise colonne passerait le
 * premier contrôle et échouerait ici.
 *
 * Tout se déroule dans une transaction annulée en sortie : la base est rendue
 * exactement dans l'état où elle a été trouvée, y compris en cas d'échec.
 */
export async function probeTenantIsolation(
  runner: QueryRunner,
  defaults: ProbeOrganizationDefaults,
): Promise<TenantIsolationReport> {
  const problems: string[] = [];

  const firstOrganizationId = `probe_${crypto.randomUUID()}`;
  const secondOrganizationId = `probe_${crypto.randomUUID()}`;

  const switchToTenant = (organizationId: string) =>
    runner.query(`select set_config($1, $2, true)`, [
      TENANT_CONTEXT_SETTING,
      organizationId,
    ]);

  const insertOrganization = (organizationId: string) =>
    runner.query(
      `insert into "organization"
         (id, name, timezone, currency, country, supported_languages)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        organizationId,
        organizationId,
        defaults.timezone,
        defaults.currency,
        defaults.country,
        defaults.supportedLanguages,
      ],
    );

  const countVisibleOrganizations = async (): Promise<number> => {
    const { rows } = await runner.query(
      `select count(*)::int as visible from "organization"`,
    );
    return Number(rows[0]?.visible ?? -1);
  };

  const insertProgram = (organizationId: string) =>
    runner.query(
      `insert into "program" (organization_id, name) values ($1, $2)`,
      [organizationId, `probe program ${organizationId}`],
    );

  const countVisiblePrograms = async (): Promise<number> => {
    const { rows } = await runner.query(
      `select count(*)::int as visible from "program"`,
    );
    return Number(rows[0]?.visible ?? -1);
  };

  await runner.query("begin");

  try {
    await switchToTenant(firstOrganizationId);
    await insertOrganization(firstOrganizationId);

    const visibleToOwner = await countVisibleOrganizations();
    if (visibleToOwner !== 1) {
      problems.push(
        `Une école ne se voit pas elle-même : ${visibleToOwner} ligne(s) visible(s) au lieu de 1. La politique est probablement trop restrictive.`,
      );
    }

    /**
     * Le curriculum est la donnée la plus révélatrice qu'une école possède :
     * ses programmes, ses niveaux, sa pédagogie. Il est donc éprouvé
     * explicitement, et pas seulement au travers de la table `organization`.
     */
    await insertProgram(firstOrganizationId);

    await switchToTenant(secondOrganizationId);

    const leaked = await countVisibleOrganizations();
    if (leaked !== 0) {
      problems.push(
        `FUITE ENTRE TENANTS : depuis le contexte d'une autre école, ${leaked} ligne(s) restent visibles. La RLS ne filtre pas.`,
      );
    }

    const leakedPrograms = await countVisiblePrograms();
    if (leakedPrograms !== 0) {
      problems.push(
        `FUITE DE CURRICULUM : depuis le contexte d'une autre école, ${leakedPrograms} programme(s) restent visibles.`,
      );
    }

    await insertOrganization(secondOrganizationId);

    const visibleToSecond = await countVisibleOrganizations();
    if (visibleToSecond !== 1) {
      problems.push(
        `La seconde école voit ${visibleToSecond} ligne(s) au lieu de la sienne uniquement.`,
      );
    }

    /**
     * Sans contexte de tenant, la politique compare à NULL : le résultat attendu
     * est zéro ligne. C'est ce qui rend sûr un accès qui aurait contourné
     * `withTenant()` — il ne renvoie rien plutôt que tout.
     */
    await runner.query(`select set_config($1, '', true)`, [
      TENANT_CONTEXT_SETTING,
    ]);

    const visibleWithoutContext = await countVisibleOrganizations();
    if (visibleWithoutContext !== 0) {
      problems.push(
        `Hors contexte de tenant, ${visibleWithoutContext} ligne(s) sont visibles : une requête échappant à withTenant() lirait des données.`,
      );
    }
  } finally {
    await runner.query("rollback");
  }

  return {
    ok: problems.length === 0,
    problems,
    checkedTables: ["organization"],
  };
}
