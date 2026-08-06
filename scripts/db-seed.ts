import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { TENANT_CONTEXT_SETTING } from "../src/config/database";
import { SORT_ORDER_STEP } from "../src/config/validation";
import {
  family,
  guardian,
  level,
  organization,
  program,
  skill,
  student,
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

    const removedPrograms = await tx
      .delete(program)
      .where(
        and(
          eq(program.organizationId, organizationId),
          eq(program.name, DEMO.program.name),
        ),
      )
      .returning({ id: program.id });

    console.log(
      [
        "Données de démonstration retirées :",
        `  ${removedFamilies.length} famille(s) — tuteurs et élèves compris`,
        `  ${removedPrograms.length} programme(s) — niveaux et compétences compris`,
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

    if (existing) {
      console.log(
        "Les données de démonstration sont déjà présentes. Rien à faire.",
      );
      return 0;
    }

    const [createdFamily] = await tx
      .insert(family)
      .values({
        organizationId,
        primaryGuardianName: DEMO.family.primaryGuardianName,
        email: DEMO.family.email,
        phone: DEMO.family.phone,
        preferredLanguage,
      })
      .returning();

    await tx.insert(guardian).values(
      DEMO.guardians.map((entry) => ({
        organizationId,
        familyId: createdFamily.id,
        name: entry.name,
        email: entry.email,
        preferredLanguage,
      })),
    );

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

    await tx.insert(student).values(
      DEMO.students.map((entry, index) => ({
        organizationId,
        familyId: createdFamily.id,
        firstName: entry.firstName,
        lastName: entry.lastName,
        dateOfBirth: entry.dateOfBirth,
        /** Seul le premier élève reçoit un niveau, pour montrer les deux cas. */
        currentLevelId: index === 0 ? (firstLevel?.id ?? null) : null,
      })),
    );

    console.log(
      [
        "Données de démonstration créées :",
        `  1 famille   ${DEMO.family.primaryGuardianName}`,
        `  2 tuteurs   ${DEMO.guardians.map((g) => g.name).join(", ")}`,
        `  2 élèves    ${DEMO.students.map((s) => `${s.firstName} ${s.lastName}`).join(", ")}`,
        firstLevel
          ? `  niveau      « ${firstLevel.name} » affecté au premier élève`
          : "  niveau      aucun niveau existant : aucune affectation",
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
