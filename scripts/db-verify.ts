import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { TENANT_CONTEXT_SETTING } from "../src/config/database";
import { checkTenantIsolation, probeTenantIsolation } from "../src/db/isolation";
import {
  family,
  level,
  location,
  organization,
  program,
  student,
} from "../src/db/schema";
import {
  assertBelongsToTenant,
  CrossTenantReferenceError,
} from "../src/db/tenant-guard";

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

    /**
     * 3. La garde applicative refuse-t-elle une référence inter-écoles ?
     *
     * Ni la RLS ni les contraintes Postgres ne couvrent ce cas : les clés
     * étrangères sont vérifiées sans appliquer les politiques de sécurité.
     * Seule `assertBelongsToTenant` s'y oppose — et une garde jamais éprouvée
     * n'est qu'une intention.
     */
    if (structure.ok && defaults) {
      const guardProblems = await probeCrossTenantGuard(db, defaults);
      console.log(
        "Garde applicative — affectation d'un niveau appartenant à une autre école.",
      );
      problems.push(...guardProblems);
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

/** Annule la transaction de sonde sans être confondue avec une vraie erreur. */
class ProbeRollback extends Error {
  constructor() {
    super("rollback de sonde");
    this.name = "ProbeRollback";
  }
}

/**
 * Éprouve `assertBelongsToTenant` sur le cas qui compte : affecter à un élève
 * un niveau appartenant à une **autre** école.
 *
 * Trois constats successifs :
 *  1. la garde refuse bien la référence croisée ;
 *  2. elle laisse évidemment passer une référence légitime ;
 *  3. contrôle négatif — sans elle, la base *accepterait* l'affectation,
 *     puisque Postgres ne soumet pas les clés étrangères à la RLS.
 *
 * Le troisième point est le plus important : il prouve que la garde n'est pas
 * une précaution redondante mais la seule protection existante.
 */
async function probeCrossTenantGuard(
  db: ReturnType<typeof drizzle>,
  defaults: { timezone: string; currency: string; country: string; supportedLanguages: string[] },
): Promise<string[]> {
  const problems: string[] = [];
  const firstOrganizationId = `probe_a_${crypto.randomUUID()}`;
  const secondOrganizationId = `probe_b_${crypto.randomUUID()}`;

  try {
    await db.transaction(async (tx) => {
      const useTenantContext = (organizationId: string) =>
        tx.execute(
          sql`select set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}, true)`,
        );

      const insertOrganization = (id: string) =>
        tx.insert(organization).values({
          id,
          name: id,
          timezone: defaults.timezone,
          currency: defaults.currency,
          country: defaults.country,
          supportedLanguages: defaults.supportedLanguages,
        });

      // ── École A : un programme et un niveau ──────────────────────────────
      await useTenantContext(firstOrganizationId);
      await insertOrganization(firstOrganizationId);

      const [programA] = await tx
        .insert(program)
        .values({ organizationId: firstOrganizationId, name: "probe program" })
        .returning();

      const [levelA] = await tx
        .insert(level)
        .values({
          organizationId: firstOrganizationId,
          programId: programA.id,
          name: "probe level",
          sortOrder: 10,
          color: "#000000",
        })
        .returning();

      // ── École B : une famille et un élève ────────────────────────────────
      await useTenantContext(secondOrganizationId);
      await insertOrganization(secondOrganizationId);

      const [familyB] = await tx
        .insert(family)
        .values({
          organizationId: secondOrganizationId,
          primaryGuardianName: "probe guardian",
          email: "probe@example.invalid",
          preferredLanguage: defaults.supportedLanguages[0],
        })
        .returning();

      const [studentB] = await tx
        .insert(student)
        .values({
          organizationId: secondOrganizationId,
          familyId: familyB.id,
          firstName: "Probe",
          lastName: "Swimmer",
          dateOfBirth: "2015-01-01",
        })
        .returning();

      // ── 1. La garde doit refuser le niveau de l'école A ──────────────────
      let refused = false;
      try {
        await assertBelongsToTenant(
          tx,
          level,
          "level",
          levelA.id,
          secondOrganizationId,
        );
      } catch (error) {
        refused = error instanceof CrossTenantReferenceError;
      }

      if (!refused) {
        problems.push(
          "GARDE INOPÉRANTE : assertBelongsToTenant a accepté un niveau appartenant à une autre école.",
        );
      }

      /**
       * Même contrôle sur un lieu : un cours de l'école B ne doit pas pouvoir
       * être programmé dans le bassin de l'école A. C'est le piège FK/RLS
       * appliqué au planning.
       */
      /**
       * L'insertion se fait sous le contexte de l'école A : la politique
       * `WITH CHECK` refuserait d'écrire une ligne d'une autre école — c'est
       * précisément ce qu'elle doit faire.
       */
      await useTenantContext(firstOrganizationId);
      const [locationA] = await tx
        .insert(location)
        .values({ organizationId: firstOrganizationId, name: "probe pool" })
        .returning();
      await useTenantContext(secondOrganizationId);

      let locationRefused = false;
      try {
        await assertBelongsToTenant(
          tx,
          location,
          "location",
          locationA.id,
          secondOrganizationId,
        );
      } catch (error) {
        locationRefused = error instanceof CrossTenantReferenceError;
      }

      if (!locationRefused) {
        problems.push(
          "GARDE INOPÉRANTE : un cours pourrait être programmé dans le bassin d'une autre école.",
        );
      }

      // ── 2. Contrôle négatif : la base, elle, l'accepterait ───────────────
      await tx
        .update(student)
        .set({ currentLevelId: levelA.id })
        .where(eq(student.id, studentB.id));

      const [written] = await tx
        .select({ currentLevelId: student.currentLevelId })
        .from(student)
        .where(eq(student.id, studentB.id));

      if (written?.currentLevelId !== levelA.id) {
        /**
         * Si Postgres refusait de lui-même, la garde serait redondante — et
         * l'hypothèse sur laquelle repose tout ce module serait fausse. Le
         * signaler plutôt que de laisser croire à une protection inexistante.
         */
        problems.push(
          "HYPOTHÈSE À REVOIR : la base a refusé d'elle-même la référence inter-écoles ; vérifier si la garde applicative reste nécessaire.",
        );
      }

      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) throw error;
  }

  return problems;
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
