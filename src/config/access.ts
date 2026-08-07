/**
 * Le second axe d'autorisation : la famille.
 *
 * ── Pourquoi un second axe ───────────────────────────────────────────────────
 *
 * Depuis la Semaine 1, une seule question décidait de tout : « de quelle école
 * s'agit-il ? ». Le parent introduit une seconde question : « de quelle famille
 * s'agit-il ? ». Ce n'est pas un rôle de plus dans la matrice du personnel —
 * un parent n'est pas un membre du personnel moins doté. C'est un autre sujet,
 * qui voit une découpe différente des mêmes données.
 *
 * ── Comment il s'ajoute sans rien casser ─────────────────────────────────────
 *
 * `withTenant()` ne pose que le contexte d'école ; `withFamily()` pose les deux.
 * Les politiques testent donc « aucun contexte famille » d'abord :
 *
 *     organization_id = <école courante>
 *     AND ( <famille courante est vide>       -- chemin personnel : inchangé
 *           OR family_id = <famille courante> )   -- chemin parent : restreint
 *
 * Les neuf semaines de code existant ne posent jamais le second paramètre :
 * leur prédicat reste littéralement le même. L'ajout ne peut donc pas régresser
 * ce qui marchait, et `db:verify` continue de le prouver.
 *
 * Le prédicat s'applique en lecture **et** en écriture (`using` et `with check`)
 * : un parent est physiquement incapable d'écrire une ligne rattachée à une
 * autre famille, sans qu'aucune action serveur n'ait à y penser.
 */

/**
 * Nom du paramètre de session Postgres qui porte la famille courante.
 *
 * ⚠️ Comme `TENANT_CONTEXT_SETTING`, cette valeur finit inscrite en dur dans le
 * SQL des migrations — du SQL ne peut pas importer du TypeScript. `db:verify`
 * échoue bruyamment si les deux divergent.
 */
export const FAMILY_CONTEXT_SETTING = "app.current_family_id";

/**
 * Ce qu'un parent a le droit de faire lui-même.
 *
 * ── Un jeu séparé, pas une ligne de plus dans la matrice du personnel ────────
 *
 * `CAPABILITIES_BY_ROLE` décrit ce que fait un membre de l'école. Un parent
 * n'en est pas un moins doté : c'est un autre sujet. Les deux univers de types
 * ne se rencontrent jamais, donc aucun contrôle ne peut accorder par accident
 * une capacité de personnel à un parent — ni l'inverse.
 *
 * ── Le nom compte ────────────────────────────────────────────────────────────
 *
 * `enrollment:self` — « s'inscrire soi-même ». Le premier nom envisagé était
 * `enrollment:request`, et il mentait : rien n'est *demandé*. Sur une place
 * libre, l'enfant est inscrit immédiatement ; sur un cours plein, il entre en
 * liste d'attente. L'école n'approuve pas en amont, elle **retire en aval** —
 * et c'est l'écran « nouvelles inscriptions » qui rend ce droit exerçable.
 * Un nom qui promet une approbation inexistante finirait par la faire croire.
 */
export const PARENT_CAPABILITIES = ["enrollment:self"] as const;

export type ParentCapability = (typeof PARENT_CAPABILITIES)[number];


/**
 * Fonction d'amorçage du portail parent : la seule lecture qui échappe à la RLS.
 *
 * Le portail doit découvrir de quelle école et de quelle famille il s'agit à
 * partir d'une adresse vérifiée — donc lire `guardian` avant d'avoir le
 * contexte que la RLS exige. Même amorçage circulaire qu'au webhook Stripe.
 *
 * Une **fonction** plutôt qu'une vue, et la différence est de nature : une vue
 * exposerait la liste de toutes les adresses e-mail de toutes les familles, en
 * lecture libre. Ici il faut déjà connaître l'adresse pour obtenir quoi que ce
 * soit, et ce qui sort ne contient aucune donnée personnelle.
 *
 * `db:verify` vérifie qu'elle ne rend que ces trois identifiants. Sans ce
 * contrôle, il suffirait d'y ajouter un jour le nom du tuteur « pour éviter une
 * requête » et l'exception s'élargirait sans que personne ne le remarque.
 */
export const GUARDIAN_LOOKUP_FUNCTION = "resolve_guardian_families";
export const GUARDIAN_LOOKUP_COLUMNS = [
  "organization_id",
  "family_id",
  "guardian_id",
];

/**
 * Tables portant directement la famille, et la colonne qui la porte.
 *
 * `family` se rattache par sa propre clé primaire : elle *est* la famille.
 */
export const FAMILY_SCOPED_TABLES: Readonly<Record<string, string>> = {
  family: "id",
  guardian: "family_id",
  student: "family_id",
  subscription: "family_id",
  invoice: "family_id",
};

/**
 * Tables rattachées à la famille **par l'élève**.
 *
 * Aucune ne porte de `family_id`, et aucune n'en portera : ce lien se dérive de
 * `student`, et matérialiser un lien dérivable finit toujours par le
 * désynchroniser — même règle que le rang de liste d'attente ou les badges.
 *
 * ⚠️ Le prix à payer est une politique à **sous-requête**, et c'est exactement
 * le genre de politique qui a l'air juste et ne filtre rien. C'est le point le
 * plus martelé de `parent-authz:verify` : il est prouvé par le comportement,
 * jamais supposé par relecture.
 */
export const STUDENT_SCOPED_TABLES: readonly string[] = [
  "enrollment",
  "attendance",
  "skill_progress",
  "makeup_credit",
];

/**
 * Le catalogue de l'école : ce qu'elle propose.
 *
 * Un parent le lit — sans le niveau ni la compétence, un badge n'a pas de nom ;
 * sans le cours ni la séance, il ne peut rien réserver. Ce ne sont pas les
 * données d'une autre famille, c'est l'offre commune.
 *
 * ⚠️ La RLS filtre des **lignes**, jamais des colonnes. Ces tables portent des
 * champs internes — `organization.stripe_account_id`, `organization.settings`,
 * `tuition_plan.stripe_price_id`. La politique autorise la ligne ; c'est aux
 * lectures du portail de ne sélectionner que les colonnes utiles. Défense en
 * profondeur : `src/db/portal-queries.ts` énumère ses colonnes une par une et
 * n'utilise jamais `select *`.
 */
export const SCHOOL_CATALOGUE_TABLES: readonly string[] = [
  "organization",
  "program",
  "level",
  "skill",
  "klass",
  "class_occurrence",
  "location",
  "term",
  "tuition_plan",
];

/**
 * La plomberie : zéro ligne dès qu'un contexte famille est posé.
 *
 * `staff_user` est la donnée du personnel — un parent n'a pas à savoir qui
 * enseigne ni à quel titre. `stripe_event` est le registre d'idempotence des
 * webhooks : de la mécanique de facturation, qui ne regarde personne d'autre
 * que le système.
 *
 * `stripe_event` est le cas particulier de la liste : n'ayant pas
 * d'`organization_id` — le webhook doit le lire *avant* de savoir de quelle
 * école il s'agit — sa politique ne peut porter que sur l'absence de contexte
 * famille. Jusqu'ici il n'avait aucune politique du tout, ni même la RLS
 * activée : n'importe quelle requête applicative le lisait.
 */
export const STAFF_ONLY_TABLES: readonly string[] = [
  "staff_user",
  "stripe_event",
];

/**
 * Toute table applicative appartient à exactement une catégorie.
 *
 * `db:verify` échoue si une table n'est déclarée nulle part, ou déclarée deux
 * fois. Sans ce contrôle, la prochaine table créée serait lisible par un parent
 * par défaut — en silence, ce qui est la pire façon d'ouvrir un accès.
 */
export const ACCESS_CATEGORIES = {
  familyScoped: Object.keys(FAMILY_SCOPED_TABLES),
  studentScoped: STUDENT_SCOPED_TABLES,
  schoolCatalogue: SCHOOL_CATALOGUE_TABLES,
  staffOnly: STAFF_ONLY_TABLES,
} as const;

export type AccessCategory = keyof typeof ACCESS_CATEGORIES;

/** La catégorie d'une table, ou `null` si elle n'est déclarée nulle part. */
export function accessCategoryOf(tableName: string): AccessCategory | null {
  for (const [category, tables] of Object.entries(ACCESS_CATEGORIES)) {
    if ((tables as readonly string[]).includes(tableName)) {
      return category as AccessCategory;
    }
  }

  return null;
}
