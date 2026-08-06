import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

/**
 * Crée (ou met à jour) le rôle Postgres avec lequel l'application se connecte,
 * et lui accorde le strict nécessaire.
 *
 * Pourquoi ce rôle existe : le rôle livré par défaut avec un projet Neon
 * (`neondb_owner`) hérite de `neon_superuser`, qui porte l'attribut `BYPASSRLS`.
 * Cet attribut neutralise toutes les politiques RLS, `FORCE ROW LEVEL SECURITY`
 * compris. Une application connectée avec lui verrait les données de toutes les
 * écoles — sans qu'aucun contrôle de configuration ne le signale.
 *
 * Le rôle est créé en SQL et non depuis la console Neon : les rôles créés
 * depuis la console sont automatiquement membres de `neon_superuser` et
 * hériteraient donc du même problème.
 *
 * Ce script se connecte avec le rôle propriétaire (`DATABASE_MIGRATION_URL`) et
 * est idempotent : le relancer après une migration réaccorde les droits sur les
 * tables nouvellement créées.
 */
async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  const roleName = process.env.DATABASE_APP_ROLE_NAME;
  const rolePassword = process.env.DATABASE_APP_ROLE_PASSWORD;

  const missing = [
    migrationUrl ? null : "DATABASE_MIGRATION_URL",
    roleName ? null : "DATABASE_APP_ROLE_NAME",
    rolePassword ? null : "DATABASE_APP_ROLE_PASSWORD",
  ].filter((entry): entry is string => entry !== null);

  if (missing.length > 0 || !migrationUrl || !roleName || !rolePassword) {
    console.error(
      `Variables manquantes dans .env.local : ${missing.join(", ")}.\n` +
        "Voir .env.local.example — DATABASE_APP_ROLE_PASSWORD se génère avec :\n" +
        "  openssl rand -base64 32",
    );
    return 1;
  }

  /**
   * Un nom de rôle ne peut pas être passé en paramètre lié : il est interpolé
   * dans le SQL. On restreint donc strictement sa forme plutôt que de faire
   * confiance à la configuration.
   */
  if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
    console.error(
      `DATABASE_APP_ROLE_NAME « ${roleName} » est invalide : minuscules, chiffres et « _ » uniquement, ne commençant pas par un chiffre.`,
    );
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString: migrationUrl });
  const client = await pool.connect();

  try {
    /**
     * `CREATE ROLE` et `ALTER ROLE` sont des instructions utilitaires : elles
     * n'acceptent pas de paramètre lié, le mot de passe doit être un littéral.
     *
     * Plutôt que d'échapper à la main, on demande à Postgres de le faire :
     * `format('%I')` produit un identifiant sûr, `format('%L')` un littéral sûr.
     * Les valeurs voyagent en paramètres liés jusqu'au dernier moment.
     */
    const { rows: quoted } = await client.query(
      `select format('%I', $1::text) as identifier,
              format('%L', $2::text) as literal`,
      [roleName, rolePassword],
    );

    const quotedRole = quoted[0].identifier as string;
    const quotedPassword = quoted[0].literal as string;

    const existing = await client.query(
      "select 1 from pg_roles where rolname = $1",
      [roleName],
    );

    if (existing.rows.length === 0) {
      await client.query(
        `create role ${quotedRole} with login nobypassrls password ${quotedPassword}`,
      );
      console.log(`Rôle ${roleName} créé.`);
    } else {
      /** Réaligne un rôle préexistant : mot de passe et absence de BYPASSRLS. */
      await client.query(
        `alter role ${quotedRole} with login nobypassrls password ${quotedPassword}`,
      );
      console.log(`Rôle ${roleName} mis à jour.`);
    }

    /**
     * Droits volontairement minimaux : lecture et écriture sur les données,
     * aucun droit de structure. Le rôle ne peut ni créer, ni modifier, ni
     * supprimer une table — donc ni retirer une politique RLS.
     */
    await client.query(`grant usage on schema public to ${quotedRole}`);
    await client.query(
      `grant select, insert, update, delete on all tables in schema public to ${quotedRole}`,
    );
    await client.query(
      `grant usage, select on all sequences in schema public to ${quotedRole}`,
    );

    /** Étend les mêmes droits aux tables créées par les futures migrations. */
    await client.query(
      `alter default privileges in schema public grant select, insert, update, delete on tables to ${quotedRole}`,
    );
    await client.query(
      `alter default privileges in schema public grant usage, select on sequences to ${quotedRole}`,
    );

    console.log("Droits accordés (données uniquement, aucun droit DDL).");

    const bypass = await client.query(
      `select bool_or(r.rolbypassrls) as bypasses
       from pg_roles r
       where pg_has_role($1, r.oid, 'USAGE')`,
      [roleName],
    );

    if (bypass.rows[0]?.bypasses) {
      console.error(
        `ÉCHEC : ${roleName} contourne encore la RLS (attribut hérité d'un rôle parent).`,
      );
      return 1;
    }

    console.log(`Vérifié : ${roleName} ne contourne pas la RLS.`);
    console.log(
      `\nRenseigne maintenant DATABASE_URL avec la chaîne de connexion de ${roleName} :\n` +
        `  ${buildAppConnectionString(migrationUrl, roleName, rolePassword)}`,
    );

    return 0;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Reprend l'URL du propriétaire en n'échangeant que l'identité : même hôte,
 * même base, mêmes paramètres. Évite une recopie manuelle source d'erreurs.
 */
function buildAppConnectionString(
  migrationUrl: string,
  roleName: string,
  rolePassword: string,
): string {
  const url = new URL(migrationUrl);
  url.username = encodeURIComponent(roleName);
  url.password = encodeURIComponent(rolePassword);
  return url.toString();
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
