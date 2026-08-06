import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { checkTenantIsolation, probeTenantIsolation } from "../src/db/isolation";

/**
 * Vérifie que la base applique réellement l'isolation multi-tenant.
 *
 * À lancer après chaque migration et en CI : c'est le garde-fou de la
 * checklist de mise en production (§9 du blueprint). Sort en code 1 si une
 * table applicative n'est pas protégée, pour faire échouer un pipeline.
 *
 * Le script ouvre sa propre connexion plutôt que de réutiliser `src/db/client`,
 * lequel est marqué `server-only` et ne peut pas s'exécuter hors de Next.js.
 *
 * Le corps est encapsulé dans une fonction : le projet n'est pas en modules ES
 * natifs, et un `await` de premier niveau ne se compilerait pas.
 */
async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error(
      "DATABASE_URL est absente. Renseigne-la dans .env.local (modèle : .env.local.example).",
    );
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  const problems: string[] = [];

  try {
    /** 1. Les politiques sont-elles déclarées, activées et forcées ? */
    const structure = await checkTenantIsolation(db);
    console.log(
      `Structure — tables auditées : ${structure.checkedTables.join(", ") || "aucune"}`,
    );
    problems.push(...structure.problems);

    /**
     * 2. Filtrent-elles réellement ? Une politique bien formée mais comparant
     * la mauvaise colonne passerait l'étape 1 sans rien protéger.
     */
    const defaults = readProbeDefaults();

    if (!defaults) {
      problems.push(
        "Sonde fonctionnelle ignorée : DEFAULT_ORGANIZATION_TIMEZONE / _CURRENCY / _COUNTRY ou NEXT_PUBLIC_SUPPORTED_LOCALES sont absentes de .env.local.",
      );
    } else if (structure.ok) {
      const client = await pool.connect();
      try {
        const behaviour = await probeTenantIsolation(client, defaults);
        console.log(
          "Comportement — deux écoles fictives créées puis annulées (transaction rollback).",
        );
        problems.push(...behaviour.problems);
      } finally {
        client.release();
      }
    }

    if (problems.length === 0) {
      console.log("\nIsolation multi-tenant : OK.");
      return 0;
    }

    console.error("\nIsolation multi-tenant : ÉCHEC.");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  } finally {
    await pool.end();
  }
}

/**
 * Valeurs utilisées pour peupler les écoles fictives de la sonde. Elles sont
 * lues depuis la configuration plutôt qu'écrites ici : la sonde exerce ainsi
 * exactement les valeurs qu'une vraie création d'école utiliserait.
 */
function readProbeDefaults() {
  const timezone = process.env.DEFAULT_ORGANIZATION_TIMEZONE;
  const currency = process.env.DEFAULT_ORGANIZATION_CURRENCY;
  const country = process.env.DEFAULT_ORGANIZATION_COUNTRY;
  const supportedLanguages = (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!timezone || !currency || !country || supportedLanguages.length === 0) {
    return null;
  }

  return { timezone, currency, country, supportedLanguages };
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
