/**
 * Réglages de la couche base de données.
 */

/**
 * Nom du paramètre de session Postgres qui porte l'organisation courante.
 *
 * C'est la clé de voûte de l'isolation multi-tenant (§7 du blueprint) : les
 * politiques RLS comparent `organization_id` à `current_setting(<cette clé>)`.
 *
 * ⚠️ Cette valeur finit inscrite en dur dans le SQL des migrations : du SQL ne
 * peut pas importer du TypeScript. Si tu la changes ici, régénère les
 * politiques — `checkTenantIsolation()` (`src/db/isolation.ts`, exécutable via
 * `npm run db:verify`) échoue bruyamment si les deux divergent.
 */
export const TENANT_CONTEXT_SETTING = "app.current_org_id";

/**
 * Le paramètre est posé avec `is_local = true` : il ne vit que le temps de la
 * transaction en cours et ne peut pas fuir vers la requête suivante servie par
 * la même connexion du pool.
 */
export const TENANT_CONTEXT_IS_TRANSACTION_LOCAL = true;
