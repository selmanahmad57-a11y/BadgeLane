import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { TENANT_CONTEXT_SETTING } from "../src/config/database";
import {
  attendance,
  classOccurrence,
  enrollment,
  family,
  klass,
  level,
  location,
  organization,
  program,
  student,
  term,
} from "../src/db/schema";
import { rosterWindowCondition } from "../src/db/roster";

/**
 * Éprouve les deux propriétés dont dépend l'app coach.
 *
 *  1. **Le rejeu est idempotent.** La file du bord du bassin retente ; renvoyer
 *     le même relevé doit produire une ligne, pas deux. C'est la contrainte
 *     d'unicité (séance, élève) qui le garantit — sans elle, la file serait
 *     dangereuse.
 *
 *  2. **La feuille est datée.** Un élève parti figure sur la feuille des
 *     séances qu'il a suivies ; un élève arrivé plus tard n'apparaît pas avant
 *     sa date d'entrée. Sans quoi rattraper un appel oublié réécrirait
 *     l'histoire.
 *
 * Tout se déroule dans une transaction annulée : la base est rendue intacte.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  console.log(
    condition ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(label);
}

class ProbeRollback extends Error {}

async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const databaseUrl = process.env.DATABASE_URL;
  const timezone = process.env.DEFAULT_ORGANIZATION_TIMEZONE;
  const currency = process.env.DEFAULT_ORGANIZATION_CURRENCY;
  const country = process.env.DEFAULT_ORGANIZATION_COUNTRY;
  const locale = (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES ?? "").split(",")[0];

  if (!databaseUrl || !timezone || !currency || !country || !locale) {
    console.error("Configuration incomplète dans .env.local.");
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const organizationId = `probe_att_${crypto.randomUUID()}`;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}, true)`,
      );

      await tx.insert(organization).values({
        id: organizationId,
        name: organizationId,
        timezone,
        currency,
        country,
        supportedLanguages: [locale],
      });

      const [p] = await tx
        .insert(program)
        .values({ organizationId, name: "probe" })
        .returning();
      const [l] = await tx
        .insert(level)
        .values({
          organizationId,
          programId: p.id,
          name: "probe",
          sortOrder: 10,
          color: "#000000",
        })
        .returning();
      const [loc] = await tx
        .insert(location)
        .values({ organizationId, name: "probe" })
        .returning();
      const [tm] = await tx
        .insert(term)
        .values({
          organizationId,
          name: "probe",
          startDate: "2026-09-01",
          endDate: "2026-12-15",
        })
        .returning();
      const [k] = await tx
        .insert(klass)
        .values({
          organizationId,
          termId: tm.id,
          programId: p.id,
          levelId: l.id,
          locationId: loc.id,
          title: "probe",
          dayOfWeek: 2,
          startTime: "17:00",
          durationMin: 30,
          capacity: 10,
        })
        .returning();

      const [occurrence] = await tx
        .insert(classOccurrence)
        .values({ organizationId, klassId: k.id, date: "2026-10-06" })
        .returning();

      const [fam] = await tx
        .insert(family)
        .values({
          organizationId,
          primaryGuardianName: "probe",
          email: `probe@${organizationId}.invalid`,
          preferredLanguage: locale,
        })
        .returning();

      const makeStudent = (first: string) =>
        tx
          .insert(student)
          .values({
            organizationId,
            familyId: fam.id,
            firstName: first,
            lastName: "Probe",
            dateOfBirth: "2015-01-01",
          })
          .returning();

      const [stayed] = await makeStudent("Stayed");
      const [left] = await makeStudent("Left");
      const [arrivedLater] = await makeStudent("ArrivedLater");

      console.log("\nFeuille de présence datée");

      await tx.insert(enrollment).values([
        /** Présent toute la session. */
        {
          organizationId,
          klassId: k.id,
          studentId: stayed.id,
          status: "active",
          startDate: "2026-09-01",
        },
        /** Parti le 20 octobre : était bien là le 6. */
        {
          organizationId,
          klassId: k.id,
          studentId: left.id,
          status: "ended",
          startDate: "2026-09-01",
          endDate: "2026-10-20",
        },
        /** Arrivé le 1er novembre : n'était pas là le 6 octobre. */
        {
          organizationId,
          klassId: k.id,
          studentId: arrivedLater.id,
          status: "active",
          startDate: "2026-11-01",
        },
      ]);

      const rosterOn = async (date: string) => {
        const rows = await tx
          .select({ id: enrollment.studentId })
          .from(enrollment)
          .where(rosterWindowCondition(organizationId, [k.id], date))
          .orderBy(asc(enrollment.studentId));
        return new Set(rows.map((row) => row.id));
      };

      const october = await rosterOn("2026-10-06");

      check("l'élève présent toute la session figure au 6 octobre", october.has(stayed.id));
      check(
        "l'élève parti le 20 octobre figure encore au 6 octobre",
        october.has(left.id),
        "l'histoire serait réécrite s'il disparaissait",
      );
      check(
        "l'élève arrivé le 1er novembre ne figure pas au 6 octobre",
        !october.has(arrivedLater.id),
      );

      const november = await rosterOn("2026-11-10");

      check("l'élève arrivé le 1er novembre figure au 10 novembre", november.has(arrivedLater.id));
      check("l'élève parti le 20 octobre ne figure plus au 10 novembre", !november.has(left.id));

      console.log("\nRejeu de la file");

      const batch = [
        {
          organizationId,
          classOccurrenceId: occurrence.id,
          studentId: stayed.id,
          status: "present" as const,
        },
        {
          organizationId,
          classOccurrenceId: occurrence.id,
          studentId: left.id,
          status: "absent" as const,
        },
      ];

      const upsert = () =>
        tx
          .insert(attendance)
          .values(batch)
          .onConflictDoUpdate({
            target: [
              attendance.organizationId,
              attendance.classOccurrenceId,
              attendance.studentId,
            ],
            set: { status: sql`excluded.status` },
          });

      await upsert();
      await upsert();
      await upsert();

      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(attendance)
        .where(
          and(
            eq(attendance.organizationId, organizationId),
            eq(attendance.classOccurrenceId, occurrence.id),
          ),
        );

      check(
        "trois envois du même lot laissent deux lignes, pas six",
        Number(total) === 2,
        `${total} ligne(s)`,
      );

      /** Un changement d'avis remplace la valeur au lieu d'ajouter une ligne. */
      await tx
        .insert(attendance)
        .values([{ ...batch[0], status: "excused" as const }])
        .onConflictDoUpdate({
          target: [
            attendance.organizationId,
            attendance.classOccurrenceId,
            attendance.studentId,
          ],
          set: { status: sql`excluded.status` },
        });

      const [after] = await tx
        .select({ status: attendance.status })
        .from(attendance)
        .where(
          and(
            eq(attendance.organizationId, organizationId),
            eq(attendance.classOccurrenceId, occurrence.id),
            eq(attendance.studentId, stayed.id),
          ),
        );

      check(
        "un relevé plus récent remplace le précédent",
        after?.status === "excused",
        after?.status,
      );

      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) {
      const detail = error as { message?: string; detail?: string; code?: string; cause?: unknown };
      console.error("  erreur :", detail?.message ?? String(error));
      if (detail?.detail) console.error("  détail :", detail.detail);
      if (detail?.code) console.error("  code   :", detail.code);
      if (detail?.cause) console.error("  cause  :", detail.cause);
      return 1;
    }
  } finally {
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nPrésence : OK.\n"
      : `\nPrésence : ÉCHEC — ${failures.length} contrôle(s).\n`,
  );

  return failures.length === 0 ? 0 : 1;
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
