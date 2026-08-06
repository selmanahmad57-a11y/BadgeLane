import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
 * Schéma BadgeLane — périmètre Fondations (§8 Phase 0 du blueprint).
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
const currentOrganizationId = sql.raw(
  `current_setting('${TENANT_CONTEXT_SETTING}', true)`,
);

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

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  () => [
    pgPolicy("organization_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`id = ${currentOrganizationId}`,
      withCheck: sql`id = ${currentOrganizationId}`,
    }),
  ],
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

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("staff_user_organization_auth_id_key").on(
      table.organizationId,
      table.authId,
    ),
    index("staff_user_organization_id_idx").on(table.organizationId),
    pgPolicy("staff_user_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`organization_id = ${currentOrganizationId}`,
      withCheck: sql`organization_id = ${currentOrganizationId}`,
    }),
  ],
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type StaffUser = typeof staffUser.$inferSelect;
export type NewStaffUser = typeof staffUser.$inferInsert;
