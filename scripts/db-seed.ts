import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { TENANT_CONTEXT_SETTING } from "../src/config/database";
import { SORT_ORDER_STEP } from "../src/config/validation";
import { occurrenceDatesFor } from "../src/lib/occurrences";
import {
  classOccurrence,
  family,
  guardian,
  klass,
  level,
  location,
  organization,
  program,
  skill,
  student,
  term,
} from "../src/db/schema";

/**
 * Jeu de données de démonstration : une famille, deux tuteurs, deux élèves.
 *
 * Trois garanties, dans l'ordre d'importance :
 *
 *  1. **Aucune écriture hors de l'école ciblée.** Le script refuse de deviner :
 *     s'il existe zéro ou plusieurs écoles, il s'arrête et demande un
 *     identifiant explicite. Personne ne veut voir des familles fictives
 *     apparaître dans une vraie école.
 *  2. **Données reconnaissables.** Tout est préfixé « Demo — » et les adresses
 *     utilisent le domaine `.invalid`, réservé par la RFC 2606 : aucun courriel
 *     ne pourra jamais leur être délivré, même par erreur.
 *  3. **Relançable sans doublons.** L'existence est vérifiée sur l'adresse de
 *     la famille avant toute insertion.
 *
 * Usage :
 *   npm run db:seed -- org_xxxxxxxxxxxx           créer les données
 *   npm run db:seed -- org_xxxxxxxxxxxx --purge   les retirer
 */

/** Préfixe rendant les données de démonstration repérables d'un coup d'œil. */
const DEMO_PREFIX = "Demo — ";

/** `.invalid` est réservé par la RFC 2606 : indélivrable par construction. */
const DEMO_DOMAIN = "badgelane.invalid";

const DEMO = {
  /**
   * Un curriculum complet, sans quoi il n'y a rien à regarder : des familles
   * sans programme ni niveau ne montrent pas le produit. Les noms de niveaux
   * suivent la progression usuelle d'une école de natation.
   */
  program: {
    name: `${DEMO_PREFIX}Learn to Swim`,
    description: "Programme de démonstration — supprimable sans conséquence.",
  },
  levels: [
    {
      name: "Guppy",
      color: "#0ea5e9",
      skills: ["Enters the water safely", "Blows bubbles for 5 seconds"],
    },
    {
      name: "Minnow",
      color: "#22c55e",
      skills: ["Floats on back for 10 seconds", "Glides 3 metres unaided"],
    },
    {
      name: "Dolphin",
      color: "#a855f7",
      skills: ["Swims 15 metres front crawl", "Treads water for 30 seconds"],
    },
  ],
  term: {
    name: `${DEMO_PREFIX}Fall 2026`,
    startDate: "2026-09-01",
    /** Traverse volontairement le changement d'heure du 1er novembre. */
    endDate: "2026-12-15",
  },
  classes: [
    { title: `${DEMO_PREFIX}Tuesday Guppies`, levelName: "Guppy", dayOfWeek: 2, startTime: "17:00", durationMin: 30, capacity: 8 },
    { title: `${DEMO_PREFIX}Thursday Minnows`, levelName: "Minnow", dayOfWeek: 4, startTime: "17:45", durationMin: 45, capacity: 6 },
    { title: `${DEMO_PREFIX}Saturday Dolphins`, levelName: "Dolphin", dayOfWeek: 6, startTime: "10:00", durationMin: 45, capacity: 10 },
  ],
  location: { name: `${DEMO_PREFIX}Main pool` },
  family: {
    primaryGuardianName: `${DEMO_PREFIX}Rivera household`,
    email: `demo.rivera@${DEMO_DOMAIN}`,
    phone: "+1 555 0100",
  },
  guardians: [
    { name: `${DEMO_PREFIX}Ana Rivera`, email: `demo.ana@${DEMO_DOMAIN}` },
    { name: `${DEMO_PREFIX}Luis Rivera`, email: `demo.luis@${DEMO_DOMAIN}` },
  ],
  students: [
    { firstName: `${DEMO_PREFIX}Mia`, lastName: "Rivera", dateOfBirth: "2016-04-12" },
    { firstName: `${DEMO_PREFIX}Noah`, lastName: "Rivera", dateOfBirth: "2018-09-30" },
  ],
} as const;

async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL est absente. Renseigne-la dans .env.local (modèle : .env.local.example).",
    );
    return 1;
  }

  const preferredLanguage = (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)[0];

  if (!preferredLanguage) {
    console.error(
      "NEXT_PUBLIC_SUPPORTED_LOCALES est absente : impossible de choisir une langue de correspondance.",
    );
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    const args = process.argv.slice(2);
    const purge = args.includes("--purge");
    const requested = args.find((entry) => !entry.startsWith("--"));

    const organizationId = await resolveTargetOrganization(db, requested);

    if (!organizationId) return 1;

    return purge
      ? await purgeOrganization(db, organizationId)
      : await seedOrganization(db, organizationId, preferredLanguage);
  } finally {
    await pool.end();
  }
}

/**
 * Retire toutes les données de démonstration de l'école ciblée.
 *
 * Ne s'appuie que sur les marqueurs — préfixe du nom, domaine `.invalid` — donc
 * ne peut pas emporter de vraie donnée. Les cascades déclarées au schéma font
 * le reste : supprimer le programme retire ses niveaux et compétences,
 * supprimer la famille retire ses tuteurs et ses élèves.
 */
async function purgeOrganization(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}, true)`,
    );

    const removedFamilies = await tx
      .delete(family)
      .where(
        and(
          eq(family.organizationId, organizationId),
          eq(family.email, DEMO.family.email),
        ),
      )
      .returning({ id: family.id });

    /** L'ordre compte : les cours référencent programme et lieu en `restrict`. */
    const removedTerms = await tx
      .delete(term)
      .where(
        and(
          eq(term.organizationId, organizationId),
          eq(term.name, DEMO.term.name),
        ),
      )
      .returning({ id: term.id });

    const removedPrograms = await tx
      .delete(program)
      .where(
        and(
          eq(program.organizationId, organizationId),
          eq(program.name, DEMO.program.name),
        ),
      )
      .returning({ id: program.id });

    const removedLocations = await tx
      .delete(location)
      .where(
        and(
          eq(location.organizationId, organizationId),
          eq(location.name, DEMO.location.name),
        ),
      )
      .returning({ id: location.id });

    console.log(
      [
        "Données de démonstration retirées :",
        `  ${removedFamilies.length} famille(s) — tuteurs et élèves compris`,
        `  ${removedTerms.length} session(s) — cours et séances compris`,
        `  ${removedPrograms.length} programme(s) — niveaux et compétences compris`,
        `  ${removedLocations.length} lieu(x)`,
      ].join("\n"),
    );

    return 0;
  });
}

/**
 * Détermine l'école cible — sans jamais retomber sur un choix par défaut.
 *
 * Le rôle applicatif ne peut pas énumérer les écoles : hors contexte de tenant,
 * la RLS masque toutes les lignes. C'est une bonne propriété, pas une gêne — et
 * elle impose ici la seule conduite sûre, celle de demander un identifiant
 * explicite plutôt que d'en deviner un.
 */
async function resolveTargetOrganization(
  db: ReturnType<typeof drizzle>,
  requested: string | undefined,
): Promise<string | null> {
  if (requested) {
    /**
     * Vérifie que l'école existe *dans son propre contexte* : c'est la seule
     * lecture possible sous RLS, et elle confirme au passage que l'identifiant
     * fourni est bien celui d'une école accessible.
     */
    const found = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config(${TENANT_CONTEXT_SETTING}, ${requested}, true)`,
      );
      const [row] = await tx
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(eq(organization.id, requested))
        .limit(1);
      return row;
    });

    if (!found) {
      console.error(
        `Aucune école « ${requested} » accessible. Vérifie l'identifiant.`,
      );
      return null;
    }

    console.log(`École ciblée : ${found.name} (${found.id})`);
    return found.id;
  }

  console.error(
    [
      "Aucune école indiquée.",
      "",
      "Le seed n'écrit jamais dans une école qu'il aurait devinée : il faut la",
      "nommer explicitement.",
      "",
      "  npm run db:seed -- <organizationId>",
      "",
      "L'identifiant est celui de l'Organization Clerk (org_…), visible dans",
      "l'URL du dashboard Clerk ou sur la page Réglages de l'école.",
    ].join("\n"),
  );
  return null;
}

async function seedOrganization(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  preferredLanguage: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}, true)`,
    );

    const [existing] = await tx
      .select({ id: family.id })
      .from(family)
      .where(
        and(
          eq(family.organizationId, organizationId),
          eq(family.email, DEMO.family.email),
        ),
      )
      .limit(1);

    /**
     * Chaque bloc est vérifié séparément.
     *
     * Une sentinelle unique — la famille, par exemple — bloquerait tout ajout
     * ultérieur au seed : les données d'une semaine passée empêcheraient
     * celles de la suivante d'être créées. Chaque ensemble porte donc son
     * propre contrôle d'existence.
     */
    const [createdFamily] = existing
      ? [existing]
      : await tx
      .insert(family)
      .values({
        organizationId,
        primaryGuardianName: DEMO.family.primaryGuardianName,
        email: DEMO.family.email,
        phone: DEMO.family.phone,
        preferredLanguage,
      })
      .returning();

    if (!existing) {
      await tx.insert(guardian).values(
      DEMO.guardians.map((entry) => ({
        organizationId,
        familyId: createdFamily.id,
        name: entry.name,
        email: entry.email,
        preferredLanguage,
      })),
      );
    }

    /**
     * Curriculum de démonstration, créé seulement s'il n'existe pas déjà.
     * Sans lui, la démonstration est vide de sens : des familles sans
     * programme ni niveau ne montrent rien du produit.
     */
    const [existingProgram] = await tx
      .select({ id: program.id })
      .from(program)
      .where(
        and(
          eq(program.organizationId, organizationId),
          eq(program.name, DEMO.program.name),
        ),
      )
      .limit(1);

    let firstLevel: { id: string; name: string } | undefined;

    if (existingProgram) {
      [firstLevel] = await tx
        .select({ id: level.id, name: level.name })
        .from(level)
        .where(eq(level.programId, existingProgram.id))
        .orderBy(asc(level.sortOrder))
        .limit(1);
    } else {
      const [createdProgram] = await tx
        .insert(program)
        .values({
          organizationId,
          name: DEMO.program.name,
          description: DEMO.program.description,
        })
        .returning();

      for (const [index, entry] of DEMO.levels.entries()) {
        const [createdLevel] = await tx
          .insert(level)
          .values({
            organizationId,
            programId: createdProgram.id,
            name: entry.name,
            color: entry.color,
            sortOrder: (index + 1) * SORT_ORDER_STEP,
          })
          .returning();

        await tx.insert(skill).values(
          entry.skills.map((name, position) => ({
            organizationId,
            levelId: createdLevel.id,
            name,
            sortOrder: (position + 1) * SORT_ORDER_STEP,
          })),
        );

        if (index === 0) {
          firstLevel = { id: createdLevel.id, name: createdLevel.name };
        }
      }
    }

    /**
     * Planning de démonstration : une session, un lieu, trois cours
     * hebdomadaires, et leurs séances générées.
     *
     * Les dates de la session traversent volontairement le changement d'heure
     * du 1er novembre : la démonstration montre donc précisément ce que le
     * §DST du blueprint demandait de ne pas casser.
     */
    const levelsByName = new Map(
      (
        await tx
          .select({ id: level.id, name: level.name, programId: level.programId })
          .from(level)
          .where(eq(level.organizationId, organizationId))
      ).map((row) => [row.name, row]),
    );

    const [existingTerm] = await tx
      .select({ id: term.id })
      .from(term)
      .where(
        and(
          eq(term.organizationId, organizationId),
          eq(term.name, DEMO.term.name),
        ),
      )
      .limit(1);

    let generatedOccurrences = 0;
    let createdClasses = 0;

    if (!existingTerm) {
      const [createdTerm] = await tx
        .insert(term)
        .values({
          organizationId,
          name: DEMO.term.name,
          startDate: DEMO.term.startDate,
          endDate: DEMO.term.endDate,
          enrollmentOpen: true,
        })
        .returning();

      const [createdLocation] = await tx
        .insert(location)
        .values({ organizationId, name: DEMO.location.name })
        .returning();

      for (const entry of DEMO.classes) {
        const target = levelsByName.get(entry.levelName);
        /** Sans le niveau correspondant, on saute plutôt que d'inventer. */
        if (!target) continue;

        const [createdClass] = await tx
          .insert(klass)
          .values({
            organizationId,
            termId: createdTerm.id,
            programId: target.programId,
            levelId: target.id,
            locationId: createdLocation.id,
            title: entry.title,
            dayOfWeek: entry.dayOfWeek,
            startTime: entry.startTime,
            durationMin: entry.durationMin,
            capacity: entry.capacity,
          })
          .returning();

        createdClasses += 1;

        const dates = occurrenceDatesFor(
          DEMO.term.startDate,
          DEMO.term.endDate,
          entry.dayOfWeek,
        );

        if (dates.length > 0) {
          await tx
            .insert(classOccurrence)
            .values(
              dates.map((date) => ({
                organizationId,
                klassId: createdClass.id,
                date,
              })),
            )
            .onConflictDoNothing();

          generatedOccurrences += dates.length;
        }
      }
    }

    /**
     * Les élèves sont réconciliés un par un, et non créés en bloc.
     *
     * Une garde « si la famille existe, ne rien faire » avait un défaut réel :
     * après avoir manipulé les données de démonstration à l'écran, relancer le
     * seed annonçait avoir affecté un niveau sans rien faire. Un script qui
     * rapporte un travail qu'il n'a pas accompli est pire qu'un script qui
     * échoue — on lui fait confiance à tort.
     */
    const knownStudents = new Map(
      (
        await tx
          .select({ id: student.id, firstName: student.firstName, currentLevelId: student.currentLevelId })
          .from(student)
          .where(eq(student.organizationId, organizationId))
      ).map((row) => [row.firstName, row]),
    );

    let createdStudents = 0;
    let restoredLevel = false;

    for (const [index, entry] of DEMO.students.entries()) {
      let record = knownStudents.get(entry.firstName);

      if (!record) {
        [record] = await tx
          .insert(student)
          .values({
            organizationId,
            familyId: createdFamily.id,
            firstName: entry.firstName,
            lastName: entry.lastName,
            dateOfBirth: entry.dateOfBirth,
          })
          .returning({ id: student.id, firstName: student.firstName, currentLevelId: student.currentLevelId });
        createdStudents += 1;
      }

      /**
       * Seul le premier élève reçoit un niveau : la démonstration montre ainsi
       * les deux cas, avec et sans. L'affectation est rétablie si elle a été
       * défaite en manipulant l'écran — c'est précisément ce qu'on attend d'un
       * jeu de démonstration qu'on relance.
       */
      if (index === 0 && firstLevel && record && !record.currentLevelId) {
        await tx
          .update(student)
          .set({ currentLevelId: firstLevel.id })
          .where(eq(student.id, record.id));
        restoredLevel = true;
      }
    }

    console.log(
      [
        "Données de démonstration créées :",
        `  1 famille   ${DEMO.family.primaryGuardianName}`,
        `  2 tuteurs   ${DEMO.guardians.map((g) => g.name).join(", ")}`,
        `  élèves      ${createdStudents} créé(s), ${DEMO.students.length - createdStudents} déjà présent(s)`,
        firstLevel
          ? restoredLevel
            ? `  niveau      « ${firstLevel.name} » (r\u00e9)affect\u00e9 au premier \u00e9l\u00e8ve`
            : `  niveau      « ${firstLevel.name} » d\u00e9j\u00e0 affect\u00e9`
          : "  niveau      aucun niveau existant : aucune affectation",
        existingTerm
          ? "  planning    déjà présent"
          : `  planning    « ${DEMO.term.name} », ${createdClasses} cours, ${generatedOccurrences} séances générées`,
        "",
        `Tout est préfixé « ${DEMO_PREFIX.trim()} » et adressé en @${DEMO_DOMAIN} pour être repérable et purgeable.`,
      ].join("\n"),
    );

    return 0;
  });
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
