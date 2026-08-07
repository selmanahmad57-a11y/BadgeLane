import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { TENANT_CONTEXT_SETTING } from "@/config/database";
import { STAFF_ROLES } from "@/config/roles";
import { ATTENDANCE_STATUSES } from "@/config/attendance";
import { TUITION_INTERVALS } from "@/config/billing";
import { ENROLLMENT_STATUSES } from "@/config/enrollment";
import { PROGRESS_STATUSES } from "@/config/progress";
import { OCCURRENCE_STATUSES } from "@/config/scheduling";

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

/**
 * Le foyer client : l'unité de facturation et, plus tard, de connexion au
 * portail parent.
 *
 * `preferredLanguage` est un simple `text`, et non un enum : figer les langues
 * dans le type Postgres imposerait une migration à chaque nouvelle langue,
 * exactement ce que le §2 du blueprint cherche à éviter. La valeur est validée
 * à l'écriture contre les langues configurées.
 */
export const family = pgTable(
  "family",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    primaryGuardianName: text("primary_guardian_name").notNull(),

    /**
     * Obligatoire : c'est le canal des rapports de progression, des relances de
     * paiement et des liens text-to-pay (§5). Une famille injoignable rend
     * l'essentiel du produit inopérant.
     */
    email: text("email").notNull(),
    phone: text("phone"),

    preferredLanguage: text("preferred_language").notNull(),

    /**
     * Client Stripe du foyer, créé au premier paiement. Repoussé en Semaine 3
     * faute de sens à l'époque : sa valeur ne se définissait qu'avec la
     * facturation.
     */
    stripeCustomerId: text("stripe_customer_id"),

    ...timestamps,
  },
  (table) => [
    index("family_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy("family", "organization_id"),
  ],
);

/**
 * Un tuteur rattaché à une famille : parent, grand-parent, responsable légal.
 *
 * Simple enregistrement de contact à ce stade. L'accès au portail parent
 * viendra en Semaine 10 ; aucune authentification n'est associée ici.
 */
export const guardian = pgTable(
  "guardian",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    /** Facultatifs : un second tuteur n'a pas toujours les deux coordonnées. */
    email: text("email"),
    phone: text("phone"),

    preferredLanguage: text("preferred_language").notNull(),

    ...timestamps,
  },
  (table) => [
    index("guardian_organization_id_idx").on(table.organizationId),
    index("guardian_family_id_idx").on(table.familyId),
    tenantIsolationPolicy("guardian", "organization_id"),
  ],
);

/** Le nageur. */
export const student = pgTable(
  "student",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),

    /**
     * Obligatoire : détermine le placement par niveau et la classification
     * COPPA (moins de 13 ans). Sans elle, la conformité prévue en Semaine 12
     * n'est pas calculable.
     */
    dateOfBirth: date("date_of_birth").notNull(),

    /**
     * `SET NULL` et non `CASCADE` — le seul endroit du schéma où la différence
     * est critique. Supprimer un niveau ne doit jamais supprimer les enfants
     * qui l'avaient atteint.
     */
    currentLevelId: uuid("current_level_id").references(() => level.id, {
      onDelete: "set null",
    }),

    /** Données de santé : champ court, par minimisation (§7 du blueprint). */
    medicalNotes: text("medical_notes"),

    ...timestamps,
  },
  (table) => [
    index("student_organization_id_idx").on(table.organizationId),
    index("student_family_id_idx").on(table.familyId),
    index("student_current_level_id_idx").on(table.currentLevelId),
    tenantIsolationPolicy("student", "organization_id"),
  ],
);

/** Une période d'enseignement : trimestre, saison, session d'été. */
export const term = pgTable(
  "term",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    /**
     * Dates civiles, sans heure ni fuseau. Une session commence « le
     * 1er septembre » pour l'école, pas à un instant précis.
     */
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),

    /** Les inscriptions sont-elles ouvertes ? Fermées par défaut. */
    enrollmentOpen: boolean("enrollment_open").notNull().default(false),

    ...timestamps,
  },
  (table) => [
    index("term_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy("term", "organization_id"),
  ],
);

/**
 * Un cours récurrent. Table `klass` : `class` est un mot réservé.
 *
 * `dayOfWeek` et `startTime` décrivent un créneau dans le **calendrier local de
 * l'école**, jamais un instant. C'est ce choix qui rend le planning insensible
 * aux changements d'heure : voir `src/lib/occurrences.ts`.
 */
export const klass = pgTable(
  "klass",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "restrict" }),
    levelId: uuid("level_id")
      .notNull()
      .references(() => level.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),

    /**
     * L'instructeur peut être absent : une classe existe avant d'être
     * attribuée. `SET NULL` plutôt que cascade — le départ d'un coach ne doit
     * pas emporter ses cours, seulement les laisser à réattribuer.
     */
    instructorId: uuid("instructor_id").references(() => staffUser.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),

    /** 0 = dimanche, convention alignée sur `getUTCDay()`. */
    dayOfWeek: smallint("day_of_week").notNull(),
    /** Heure locale de l'école, format `HH:MM`. */
    startTime: time("start_time").notNull(),
    durationMin: integer("duration_min").notNull(),
    capacity: integer("capacity").notNull(),

    active: boolean("active").notNull().default(true),

    ...timestamps,
  },
  (table) => [
    index("klass_organization_id_idx").on(table.organizationId),
    index("klass_term_id_idx").on(table.termId),
    index("klass_instructor_id_idx").on(table.instructorId),
    tenantIsolationPolicy("klass", "organization_id"),
  ],
);

export const occurrenceStatusEnum = pgEnum(
  "occurrence_status",
  OCCURRENCE_STATUSES,
);

/**
 * Une séance datée. Porte bientôt la présence (Semaine 6) et les compétences
 * validées (Semaine 7) — d'où la prudence de la réconciliation.
 *
 * `date` sans heure : l'heure vit sur la classe. Combinées au fuseau de
 * l'école, elles donnent l'instant réel, calculé seulement quand il est
 * nécessaire.
 */
export const classOccurrence = pgTable(
  "class_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    klassId: uuid("klass_id")
      .notNull()
      .references(() => klass.id, { onDelete: "cascade" }),

    date: date("date").notNull(),
    status: occurrenceStatusEnum("status").notNull().default("scheduled"),

    ...timestamps,
  },
  (table) => [
    /**
     * Rend le doublon impossible au niveau base, et non seulement au niveau
     * code : la génération peut alors insérer sans vérifier, et rester
     * idempotente même si deux appels se croisent.
     */
    uniqueIndex("class_occurrence_klass_date_key").on(
      table.organizationId,
      table.klassId,
      table.date,
    ),
    index("class_occurrence_organization_id_idx").on(table.organizationId),
    index("class_occurrence_date_idx").on(table.date),
    tenantIsolationPolicy("class_occurrence", "organization_id"),
  ],
);

export const enrollmentStatusEnum = pgEnum(
  "enrollment_status",
  ENROLLMENT_STATUSES,
);

/**
 * Le lien entre un élève et un cours, quel que soit son état.
 *
 * Table unique : être en liste d'attente est un statut, pas une autre table.
 * Promouvoir quelqu'un revient donc à changer un champ, non à déplacer une
 * ligne d'une table vers une autre — opération qui, faite en deux temps, finit
 * toujours par échouer entre les deux.
 *
 * Le rang dans la file n'est pas stocké : il se dérive de `waitlistedAt`. Une
 * donnée dérivable ne se saisit pas — et un entier de position exigerait une
 * renumérotation à chaque départ, avec sa propre course.
 */
export const enrollment = pgTable(
  "enrollment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    klassId: uuid("klass_id")
      .notNull()
      .references(() => klass.id, { onDelete: "cascade" }),

    status: enrollmentStatusEnum("status").notNull().default("active"),

    /**
     * Instant d'entrée en liste d'attente. Seule source du rang, qui se calcule
     * à la lecture. Null dès que l'inscription devient active.
     */
    waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),

    /**
     * Début effectif dans le cours, en date civile de l'école. Posé au moment
     * où l'inscription devient active — jamais reconstruit après coup : la
     * facturation au prorata de la Semaine 8 en dépendra, et `created_at` ne
     * le remplacerait pas fidèlement pour un élève promu depuis l'attente.
     */
    startDate: date("start_date"),
    /** Fin effective, posée à la clôture. */
    endDate: date("end_date"),

    ...timestamps,
  },
  (table) => [
    index("enrollment_organization_id_idx").on(table.organizationId),
    index("enrollment_klass_id_idx").on(table.klassId),
    index("enrollment_student_id_idx").on(table.studentId),
    tenantIsolationPolicy("enrollment", "organization_id"),
  ],
);

export const attendanceStatusEnum = pgEnum(
  "attendance_status",
  ATTENDANCE_STATUSES,
);

/**
 * L'appel : qui était là, à quelle séance.
 *
 * L'unicité par (séance, élève) n'est pas une commodité mais la condition de
 * l'app coach : elle transforme chaque envoi en `upsert`, donc en opération
 * rejouable sans risque. C'est elle qui rend sûre la file locale du bord du
 * bassin — sans elle, une reconnexion produirait des doublons, et une file
 * qu'on ne peut pas retenter ne sert à rien.
 *
 * `marked_by` est toujours la session qui écrit, jamais une identité affirmée
 * par le navigateur : la file est cloisonnée par membre, l'attribution est donc
 * correcte par construction.
 */
export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    classOccurrenceId: uuid("class_occurrence_id")
      .notNull()
      .references(() => classOccurrence.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),

    status: attendanceStatusEnum("status").notNull(),

    /**
     * Auteur du relevé. `SET NULL` : le départ d'un coach ne doit pas effacer
     * les appels qu'il a faits — l'information « quelqu'un a relevé cette
     * présence » survit à la personne.
     */
    markedBy: uuid("marked_by").references(() => staffUser.id, {
      onDelete: "set null",
    }),
    markedAt: timestamp("marked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("attendance_occurrence_student_key").on(
      table.organizationId,
      table.classOccurrenceId,
      table.studentId,
    ),
    index("attendance_organization_id_idx").on(table.organizationId),
    index("attendance_occurrence_idx").on(table.classOccurrenceId),
    tenantIsolationPolicy("attendance", "organization_id"),
  ],
);

export const progressStatusEnum = pgEnum(
  "progress_status",
  PROGRESS_STATUSES,
);

/**
 * Ce qu'un nageur a acquis, compétence par compétence. Le cœur du produit.
 *
 * Une ligne n'existe **que** si un coach a marqué quelque chose : l'absence de
 * ligne vaut « pas commencé ». Rien n'est pré-créé, ni à l'inscription, ni
 * quand une compétence s'ajoute au curriculum.
 *
 * L'unicité (école, élève, compétence) est posée **avant** que la file
 * hors-ligne ne s'y branche : c'est elle qui transforme l'envoi en `upsert`,
 * donc qui rend le rejeu sûr. Une file qu'on ne peut pas retenter ne sert à
 * rien.
 *
 * Le badge de niveau n'est pas ici : il se calcule. Un niveau est acquis quand
 * toutes ses compétences le sont — ajouter une compétence retire donc le badge
 * à ceux qui ne l'ont pas encore. Un badge stocké exigerait un recalcul à
 * chaque modification du curriculum, et se tromperait un jour.
 */
export const skillProgress = pgTable(
  "skill_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),

    status: progressStatusEnum("status").notNull(),

    /** Posé quand le statut devient `achieved`, effacé s'il régresse. */
    achievedAt: timestamp("achieved_at", { withTimezone: true }),

    /**
     * Coach ayant validé. `SET NULL` : un badge survit au départ de celui qui
     * l'a accordé. L'accomplissement de l'enfant reste, seule l'attribution
     * s'efface.
     */
    coachId: uuid("coach_id").references(() => staffUser.id, {
      onDelete: "set null",
    }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("skill_progress_student_skill_key").on(
      table.organizationId,
      table.studentId,
      table.skillId,
    ),
    index("skill_progress_organization_id_idx").on(table.organizationId),
    index("skill_progress_student_id_idx").on(table.studentId),
    tenantIsolationPolicy("skill_progress", "organization_id"),
  ],
);

export const tuitionIntervalEnum = pgEnum(
  "tuition_interval",
  TUITION_INTERVALS,
);

/** Un tarif de scolarité, adossé à un prix Stripe. */
export const tuitionPlan = pgTable(
  "tuition_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /**
     * Montant en plus petite unité monétaire — centimes pour un dollar ou un
     * euro. Jamais un nombre à virgule : additionner des flottants finit
     * toujours par produire un centime qui n'existe pas.
     *
     * La devise n'est pas répétée ici : c'est celle de l'école.
     */
    amount: integer("amount").notNull(),
    interval: tuitionIntervalEnum("interval").notNull(),

    /** Prix Stripe correspondant. Null tant qu'il n'a pas été créé. */
    stripePriceId: text("stripe_price_id"),

    active: boolean("active").notNull().default(true),

    ...timestamps,
  },
  (table) => [
    index("tuition_plan_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy("tuition_plan", "organization_id"),
  ],
);

/**
 * Miroir d'un abonnement Stripe.
 *
 * Rien ici n'est décidé par BadgeLane : `status` et `currentPeriodEnd` sont
 * recopiés de Stripe, qui détient la vérité. `status` est un `text` et non un
 * enum — c'est le vocabulaire de Stripe, et le figer imposerait une migration
 * le jour où il s'enrichit.
 */
export const subscription = pgTable(
  "subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    tuitionPlanId: uuid("tuition_plan_id").references(() => tuitionPlan.id, {
      onDelete: "set null",
    }),

    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    /** Un abonnement Stripe ne se reflète qu'une fois : rejeu sûr. */
    uniqueIndex("subscription_stripe_id_key").on(
      table.organizationId,
      table.stripeSubscriptionId,
    ),
    index("subscription_organization_id_idx").on(table.organizationId),
    index("subscription_family_id_idx").on(table.familyId),
    tenantIsolationPolicy("subscription", "organization_id"),
  ],
);

/** Miroir d'une facture Stripe. En lecture seule côté BadgeLane. */
export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),

    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    amount: integer("amount").notNull(),
    /** Devise de la facture, telle que Stripe l'a émise. */
    currency: text("currency").notNull(),
    status: text("status").notNull(),

    dueDate: timestamp("due_date", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("invoice_stripe_id_key").on(
      table.organizationId,
      table.stripeInvoiceId,
    ),
    index("invoice_organization_id_idx").on(table.organizationId),
    index("invoice_family_id_idx").on(table.familyId),
    tenantIsolationPolicy("invoice", "organization_id"),
  ],
);

/**
 * Registre des événements Stripe déjà traités.
 *
 * ── L'état invalide est rendu impossible ─────────────────────────────────────
 *
 * `processedAt` est `NOT NULL`, et la ligne est écrite **dans la même
 * transaction** que le miroir qu'elle décrit. Une ligne à demi traitée ne peut
 * donc pas exister : soit tout est commis, soit rien ne l'est.
 *
 * C'est ce qui rend le retry de Stripe sans danger et sans logique
 * particulière. Le schéma précédent — insérer d'abord, marquer ensuite —
 * laissait une fenêtre où un plantage produisait une ligne avec `processed_at`
 * nul ; au retry, la voir aurait fait sauter un événement jamais traité, et
 * perdre une mise à jour de paiement en silence.
 *
 * La clé primaire est l'identifiant de l'événement : un doublon est une
 * violation de contrainte, donc impossible plutôt que détecté.
 *
 * Pas de politique RLS ni d'`organization_id` : ce registre ne porte aucune
 * donnée d'école, seulement des identifiants d'événements. L'y rattacher
 * exigerait un contexte de tenant que le webhook n'a pas encore au moment de
 * s'en servir.
 */
export const stripeEvent = pgTable("stripe_event", {
  /** Identifiant Stripe (`evt_…`), clé primaire à dessein. */
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
export type Family = typeof family.$inferSelect;
export type NewFamily = typeof family.$inferInsert;
export type Guardian = typeof guardian.$inferSelect;
export type NewGuardian = typeof guardian.$inferInsert;
export type Student = typeof student.$inferSelect;
export type NewStudent = typeof student.$inferInsert;
export type Term = typeof term.$inferSelect;
export type NewTerm = typeof term.$inferInsert;
export type Klass = typeof klass.$inferSelect;
export type NewKlass = typeof klass.$inferInsert;
export type ClassOccurrence = typeof classOccurrence.$inferSelect;
export type NewClassOccurrence = typeof classOccurrence.$inferInsert;
export type Enrollment = typeof enrollment.$inferSelect;
export type NewEnrollment = typeof enrollment.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type SkillProgress = typeof skillProgress.$inferSelect;
export type NewSkillProgress = typeof skillProgress.$inferInsert;
export type TuitionPlan = typeof tuitionPlan.$inferSelect;
export type NewTuitionPlan = typeof tuitionPlan.$inferInsert;
export type Subscription = typeof subscription.$inferSelect;
export type Invoice = typeof invoice.$inferSelect;
