import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { TENANT_CONTEXT_SETTING } from "@/config/database";
import { STAFF_ROLES } from "@/config/roles";

/**
 * Schéma BadgeLane.
 *
 * Convention de nommage : tables au singulier, comme le blueprint. Les noms
 * réservés par Postgres sont préfixés — le blueprint applique déjà la règle à
 * `class` -> `klass` ; `user` est réservé de la même façon, d'où `staff_user`.
 */

/**
 * Expression SQL de l'organisation courante, lue depuis le paramètre de session
 * posé par `withTenant()`. Le second argument `true` demande à Postgres de
 * renvoyer NULL au lieu de lever une erreur quand le paramètre n'est pas posé :
 * une requête hors contexte de tenant ne voit donc *aucune* ligne, au lieu de
 * planter — et surtout au lieu de tout voir.
 */
const CURRENT_ORGANIZATION_ID = `current_setting('${TENANT_CONTEXT_SETTING}', true)`;

/**
 * Politique d'isolation, identique pour toute table portant des données
 * d'école. Factorisée à dessein : recopier ce prédicat table après table
 * multiplierait les occasions de se tromper de colonne — et une politique
 * comparant la mauvaise colonne passe inaperçue à l'inspection.
 *
 * `npm run db:verify` vérifie que chaque table en possède une.
 */
function tenantIsolationPolicy(tableName: string, column: string) {
  return pgPolicy(`${tableName}_tenant_isolation`, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql.raw(`${column} = ${CURRENT_ORGANIZATION_ID}`),
    withCheck: sql.raw(`${column} = ${CURRENT_ORGANIZATION_ID}`),
  });
}

/** Colonnes de traçabilité présentes sur toutes les tables métier. */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);

/**
 * L'école. C'est le tenant : toute autre table porte un `organization_id`.
 *
 * `id` reprend l'identifiant d'Organization Clerk plutôt qu'un UUID interne.
 * Raison : le contexte RLS doit pouvoir être posé à partir de la seule session
 * vérifiée (`auth().orgId`), sans requête de résolution préalable — une requête
 * qui devrait elle-même s'exécuter hors RLS, et donc ouvrir une brèche.
 */
export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),

    /** Fuseau IANA de l'école — dicte l'affichage des horaires de cours. */
    timezone: text("timezone").notNull(),
    /** Devise ISO 4217 utilisée pour la facturation. */
    currency: text("currency").notNull(),
    /** Pays ISO 3166-1 alpha-2 — conditionne le régime de conformité applicable. */
    country: text("country").notNull(),

    /** Langues que cette école sert à ses familles (§2 du blueprint). */
    supportedLanguages: text("supported_languages").array().notNull(),

    /** Compte Stripe Connect de l'école. Null tant que l'onboarding n'est pas fait. */
    stripeAccountId: text("stripe_account_id"),

    /**
     * Ouvre le widget d'inscription public (§4-D). Fermé par défaut : exposer
     * publiquement des créneaux doit être un acte explicite de l'école.
     */
    publicBookingEnabled: boolean("public_booking_enabled")
      .notNull()
      .default(false),

    settings: jsonb("settings").notNull().default({}),

    ...timestamps,
  },
  () => [tenantIsolationPolicy("organization", "id")],
);

/**
 * Membre du personnel : owner, admin ou coach.
 *
 * Un même compte Clerk peut appartenir à plusieurs écoles : la clé primaire est
 * donc un UUID interne, et l'unicité porte sur le couple (école, compte Clerk).
 */
export const staffUser = pgTable(
  "staff_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    /** Identifiant du compte Clerk (`user_…`). */
    authId: text("auth_id").notNull(),

    email: text("email").notNull(),
    fullName: text("full_name"),

    /**
     * Rôle faisant autorité côté produit. Initialisé depuis le rôle
     * d'organisation Clerk, puis modifiable dans les réglages (§4-A).
     */
    role: staffRoleEnum("role").notNull(),

    /** Un membre désactivé conserve son historique mais perd tout accès. */
    active: boolean("active").notNull().default(true),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("staff_user_organization_auth_id_key").on(
      table.organizationId,
      table.authId,
    ),
    index("staff_user_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy("staff_user", "organization_id"),
  ],
);

/** Lieu où se déroulent les cours : un bassin, un site. */
export const location = pgTable(
  "location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    address: text("address"),

    ...timestamps,
  },
  (table) => [
    index("location_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy("location", "organization_id"),
  ],
);

/**
 * Un programme d'enseignement, ex. « Learn to Swim ».
 *
 * Racine du curriculum : programme -> niveaux -> compétences. C'est la
 * structure qui porte le suivi de progression par badges (§0 du blueprint),
 * fonctionnalité distinctive prévue en Semaine 7.
 */
export const program = pgTable(
  "program",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),

    ...timestamps,
  },
  (table) => [
    index("program_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy("program", "organization_id"),
  ],
);

/**
 * Un niveau au sein d'un programme, ex. « Guppy », « Dauphin ».
 *
 * `sortOrder` porte la progression : c'est l'ordre dans lequel un nageur
 * franchit les niveaux, pas un simple ordre d'affichage.
 */
export const level = pgTable(
  "level",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),

    /**
     * Couleur du niveau, en hexadécimal. Les écoles de natation identifient
     * couramment leurs niveaux par une couleur ; elle sert aussi de repère
     * visuel aux badges de progression.
     */
    color: text("color").notNull(),

    ...timestamps,
  },
  (table) => [
    index("level_organization_id_idx").on(table.organizationId),
    index("level_program_id_idx").on(table.programId),
    tenantIsolationPolicy("level", "organization_id"),
  ],
);

/**
 * Une compétence à acquérir dans un niveau, ex. « flotte 5 secondes ».
 *
 * Unité élémentaire de la progression : c'est cette ligne que le coach cochera
 * au bord du bassin, et qui deviendra un badge sur la fiche de l'enfant.
 */
export const skill = pgTable(
  "skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    levelId: uuid("level_id")
      .notNull()
      .references(() => level.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),

    ...timestamps,
  },
  (table) => [
    index("skill_organization_id_idx").on(table.organizationId),
    index("skill_level_id_idx").on(table.levelId),
    tenantIsolationPolicy("skill", "organization_id"),
  ],
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type StaffUser = typeof staffUser.$inferSelect;
export type NewStaffUser = typeof staffUser.$inferInsert;
export type Location = typeof location.$inferSelect;
export type NewLocation = typeof location.$inferInsert;
export type Program = typeof program.$inferSelect;
export type NewProgram = typeof program.$inferInsert;
export type Level = typeof level.$inferSelect;
export type NewLevel = typeof level.$inferInsert;
export type Skill = typeof skill.$inferSelect;
export type NewSkill = typeof skill.$inferInsert;
