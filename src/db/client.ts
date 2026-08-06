import "server-only";

import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { serverEnv } from "@/config/env.server";
import { isProduction } from "@/config/runtime";

import * as schema from "./schema";

/**
 * Connexion Neon en mode WebSocket (`drizzle-orm/neon-serverless`).
 *
 * Le driver HTTP de Neon est plus léger, mais chaque requête y est une
 * transaction isolée : un `set_config(..., is_local => true)` n'y survivrait pas
 * à la requête suivante, ce qui rendrait l'isolation RLS inopérante. Le mode
 * WebSocket donne de vraies transactions interactives — condition nécessaire au
 * contexte de tenant décrit dans `src/db/tenant.ts`.
 */
neonConfig.webSocketConstructor =
  globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

/**
 * En développement, Next.js recharge les modules à chaud ; sans ce cache, chaque
 * édition ouvrirait un pool supplémentaire jusqu'à épuiser les connexions Neon.
 */
const globalForDatabase = globalThis as unknown as {
  badgeLanePool?: Pool;
};

const pool =
  globalForDatabase.badgeLanePool ??
  new Pool({
    connectionString: serverEnv.DATABASE_URL,
    ...(serverEnv.DATABASE_POOL_MAX === undefined
      ? {}
      : { max: serverEnv.DATABASE_POOL_MAX }),
  });

if (!isProduction) {
  globalForDatabase.badgeLanePool = pool;
}

/**
 * Client Drizzle brut.
 *
 * ⚠️ Ne l'utilise pas directement pour lire ou écrire des données d'école : sans
 * contexte de tenant, les politiques RLS ne renvoient aucune ligne. Passe par
 * `withTenant()` (`src/db/tenant.ts`).
 */
export const db = drizzle(pool, { schema });

export type Database = typeof db;
