import { neonConfig, Pool } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  skill,
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

    /**
     * 4. Le contexte de tenant est-il toujours posé LOCALEMENT à la transaction ?
     *
     * Ce contrôle ne lit pas la base : il lit le code source. Et c'est le seul
     * moyen d'attraper la faille qu'il vise, parce qu'elle ne se manifeste ni en
     * développement ni sous un test unitaire.
     */
    problems.push(...checkSessionContextDiscipline());
    console.log(
      "Code source — le contexte de tenant n'est posé que par withTenant/withFamily, et localement.",
    );

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

      /**
       * Et sur les compétences : un coach ne doit pas pouvoir valider une
       * compétence appartenant au curriculum d'une autre école. Même piège
       * FK/RLS, appliqué à la donnée la plus visible du produit.
       */
      await useTenantContext(firstOrganizationId);
      const [skillA] = await tx
        .insert(skill)
        .values({
          organizationId: firstOrganizationId,
          levelId: levelA.id,
          name: "probe skill",
          sortOrder: 10,
        })
        .returning();
      await useTenantContext(secondOrganizationId);

      let skillRefused = false;
      try {
        await assertBelongsToTenant(
          tx,
          skill,
          "skill",
          skillA.id,
          secondOrganizationId,
        );
      } catch (error) {
        skillRefused = error instanceof CrossTenantReferenceError;
      }

      if (!skillRefused) {
        problems.push(
          "GARDE INOPÉRANTE : une compétence d'une autre école pourrait être validée.",
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

/**
 * Le seul module autorisé à poser un contexte de tenant applicatif.
 * Tout le reste doit passer par `withTenant()` / `withFamily()`.
 */
const TENANT_CONTEXT_OWNER = "src/db/tenant.ts";

/**
 * Exception nommée : le module d'audit construit délibérément des contextes
 * pour éprouver les politiques. Il les pose toujours localement, et c'est son
 * métier — mais l'exception doit être écrite, pas tolérée en silence.
 */
const TENANT_CONTEXT_PROBES = ["src/db/isolation.ts"];

/** Répertoires balayés : le code de l'application et celui des sondes. */
const SCANNED_ROOTS = ["src", "scripts"];

/**
 * Motifs construits à l'exécution plutôt qu'écrits en littéraux.
 *
 * Sans cela, ce fichier se dénoncerait lui-même : la ligne qui décrit
 * l'interdit la contient. Un contrôle qui échoue sur sa propre définition
 * apprend à être ignoré — et un contrôle qu'on ignore ne protège plus rien.
 */
const SESSION_SCOPED_SET_CONFIG = new RegExp(
  "set" + "_config\\([^)]*,\\s*false\\s*\\)",
);
const ANY_SET_CONFIG = new RegExp("set" + "_config\\(");
const BARE_SQL_SET = new RegExp("\\bset\\s+app\\.current_", "i");

/**
 * Éprouve la discipline du contexte de session, en lisant le code.
 *
 * ── La faille visée ──────────────────────────────────────────────────────────
 *
 * `DATABASE_URL` passe par un pooler en **mode transaction** : les connexions
 * physiques sont recyclées d'une transaction à l'autre, et entre des tenants
 * différents. Un `set_config(…, false)` — de portée session — **survit donc au
 * client qui l'a posé**, et la transaction suivante en hérite.
 *
 * Concrètement : l'école A pose son contexte, sa transaction s'achève, la
 * connexion retourne au pool, l'école B l'emprunte — et lit les données de A.
 * C'est la pire forme de fuite inter-tenant, parce qu'elle est **invisible en
 * développement** : une seule connexion, aucune contention, tout marche. Elle
 * n'apparaît qu'en production sous charge, et aucun test unitaire ne la voit.
 *
 * ── Pourquoi un contrôle sur le source, et non sur la base ───────────────────
 *
 * Il n'existe aucune trace en base d'un réglage mal posé : le mal est fait au
 * moment de l'appel, et la requête suivante paraît parfaitement normale. Seul
 * le code peut être interrogé. Même famille que le piège `.next` : un défaut
 * qu'aucune assertion runtime n'atteint, et qui se garde donc en amont.
 */
function checkSessionContextDiscipline(): string[] {
  const problems: string[] = [];

  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  for (const root of SCANNED_ROOTS) {
    for (const file of walk(root)) {
      const relative = file.replace(/\\/g, "/");

      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const trimmed = line.trim();

          /** Les commentaires décrivent la règle ; ils ne l'enfreignent pas. */
          if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;

          const at = `${relative}:${index + 1}`;

          /**
           * `false` en troisième argument = portée session. Interdit partout,
           * sans exception : c'est la forme exacte qui fuite au pooler.
           */
          if (SESSION_SCOPED_SET_CONFIG.test(line)) {
            problems.push(
              `${at} : pose le contexte avec une portée SESSION — troisième argument à « false ». Derrière un pooler en mode transaction, ce réglage survit à la transaction, et la suivante — d'un autre tenant — en hérite. Passe « true », à l'intérieur d'une transaction.`,
            );
          }

          /** Un `SET` SQL nu est de portée session par défaut : même faille. */
          if (BARE_SQL_SET.test(line) && !ANY_SET_CONFIG.test(line)) {
            problems.push(
              `${at} : \`SET app.current_…\` est de portée session par défaut. Passe par \`set_config(…, true)\`, ou par withTenant()/withFamily().`,
            );
          }

          /**
           * Hors du module propriétaire et des sondes, personne ne pose de
           * contexte à la main : les écritures et lectures applicatives
           * passent par withTenant()/withFamily(), qui seuls savent le faire.
           */
          if (
            ANY_SET_CONFIG.test(line) &&
            relative.startsWith("src/") &&
            relative !== TENANT_CONTEXT_OWNER &&
            !TENANT_CONTEXT_PROBES.includes(relative)
          ) {
            problems.push(
              `${at} : pose un contexte de tenant hors de ${TENANT_CONTEXT_OWNER}. Un second endroit qui sait le faire est un second endroit où l'oublier.`,
            );
          }
        });
    }
  }

  return problems;
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
