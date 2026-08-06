import { config as loadEnvFile } from "dotenv";
import { defineConfig } from "drizzle-kit";

/**
 * Configuration de drizzle-kit (génération et application des migrations).
 *
 * Ce fichier s'exécute hors de Next.js : il charge lui-même `.env.local`, et ne
 * réutilise pas `src/config/env.server.ts` — outiller la base ne doit pas
 * exiger les clés Clerk ou Sentry.
 */
loadEnvFile({ path: ".env.local", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    /**
     * Accesseur plutôt que valeur : `drizzle-kit generate` produit du SQL sans
     * jamais se connecter. L'absence de `DATABASE_URL` ne doit donc bloquer que
     * les commandes qui ouvrent réellement une connexion (`migrate`, `studio`).
     */
    get url(): string {
      /**
       * Les migrations utilisent le rôle propriétaire, pas celui de
       * l'application : créer une table ou une politique exige des droits DDL
       * que le rôle applicatif n'a délibérément pas.
       */
      const migrationUrl = process.env.DATABASE_MIGRATION_URL;

      if (!migrationUrl) {
        throw new Error(
          "DATABASE_MIGRATION_URL est absente. Renseigne-la dans .env.local (modèle : .env.local.example) avant de lancer cette commande drizzle-kit.",
        );
      }

      return migrationUrl;
    },
  },
  /**
   * Sans cette option, drizzle-kit tenterait de gérer les rôles Postgres et
   * ignorerait les politiques déclarées via `pgPolicy()` : les migrations
   * générées n'embarqueraient aucune RLS.
   */
  entities: { roles: false },
  verbose: true,
  strict: true,
});
