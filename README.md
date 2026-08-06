# BadgeLane

Logiciel de gestion d'école de natation. Voir [BLUEPRINT.md](BLUEPRINT.md) pour
le cahier des charges et [ROADMAP.md](ROADMAP.md) pour le plan semaine par semaine.

**État : Phase 0 — Fondations.** Squelette multi-tenant déployable, avec
authentification, isolation RLS et internationalisation câblées.

---

## Règle du projet : aucune valeur en dur

Toute valeur configurable vient d'une variable d'environnement validée au
démarrage, ou d'un module de `src/config/`. Une variable manquante fait échouer
le boot avec un message qui la nomme — jamais de valeur devinée en silence.

| Besoin | Où ça vit |
|---|---|
| Secrets, connexions, réglages de déploiement | `.env.local`, validé par `src/config/env.*.ts` |
| Textes affichés | `messages/<langue>.json` |
| Chemins de routes | `src/config/routes.ts` |
| Rôles du personnel | `src/config/roles.ts` |
| Clé de session RLS | `src/config/database.ts` |

---

## Démarrage

### 1. Dépendances

```bash
npm install
```

### 2. Configuration

```bash
cp .env.local.example .env.local
```

`.env.local.example` documente chaque variable, sa provenance et son caractère
obligatoire ou non. Trois comptes à créer :

**Neon** — [console.neon.tech](https://console.neon.tech) → nouveau projet →
*Connection Details* → copier la chaîne **Pooled connection** (elle contient
`-pooler`) dans `DATABASE_MIGRATION_URL`.

Puis générer le mot de passe du rôle applicatif :

```bash
openssl rand -base64 32   # → DATABASE_APP_ROLE_PASSWORD
```

`DATABASE_URL` reste vide à ce stade : l'étape 3 la renseigne.

**Clerk** — [dashboard.clerk.com](https://dashboard.clerk.com) → nouvelle
application → *API Keys* → copier les deux clés dans
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` et `CLERK_SECRET_KEY`.
⚠️ Activer ensuite **Organizations** dans *Configure → Organizations* : chaque
école est une Organization Clerk. Sans ça, la création d'école ne fonctionne pas.

**Sentry** — facultatif. Laisser les variables vides : l'application démarre et
fonctionne sans compte Sentry, le SDK reste simplement inactif.

À décider toi-même selon le marché visé — aucune valeur par défaut n'a été
inventée : `DEFAULT_ORGANIZATION_TIMEZONE`, `DEFAULT_ORGANIZATION_CURRENCY`,
`DEFAULT_ORGANIZATION_COUNTRY`.

### 3. Base de données

```bash
npm run db:migrate   # applique les migrations, RLS comprise (rôle propriétaire)
npm run db:grant     # crée le rôle applicatif et affiche sa chaîne de connexion
                     # → copier cette chaîne dans DATABASE_URL
npm run db:verify    # audite l'isolation multi-tenant
```

**Pourquoi deux rôles.** Le rôle livré par défaut avec un projet Neon
(`neondb_owner`) hérite de `neon_superuser`, qui porte l'attribut `BYPASSRLS`.
Cet attribut neutralise *toutes* les politiques RLS, `FORCE ROW LEVEL SECURITY`
compris. Une application connectée avec lui lirait les données de chaque école
sans qu'aucune inspection de configuration ne le révèle. D'où la séparation :

| Rôle | Variable | Droits |
|---|---|---|
| propriétaire | `DATABASE_MIGRATION_URL` | DDL — migrations uniquement |
| `badgelane_app` | `DATABASE_URL` | données uniquement, sans `BYPASSRLS` |

`db:grant` est idempotent : le relancer après une migration réaccorde les droits
sur les tables nouvellement créées.

`db:verify` sort en code 1 si l'isolation n'est pas garantie. À lancer après
chaque migration et en CI. Il fait deux passes :

1. **structure** — RLS activée, forcée, politiques référençant la bonne clé, et
   rôle de connexion dépourvu de `BYPASSRLS` ;
2. **comportement** — deux écoles fictives sont créées puis chacune est
   recherchée depuis le contexte de l'autre. Tout se déroule dans une
   transaction annulée : la base est rendue intacte.

La seconde passe existe parce que la première ne suffit pas. Une politique
syntaxiquement parfaite peut ne rien filtrer.

### 4. Lancer

```bash
npm run dev
```

Parcours attendu : créer un compte → créer une école → arriver sur un dashboard
vide affichant le nom de l'école, ton rôle, son fuseau et sa devise.

---

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Génère une migration depuis `src/db/schema.ts` |
| `npm run db:migrate` | Applique les migrations (rôle propriétaire) |
| `npm run db:grant` | Crée le rôle applicatif et lui accorde ses droits |
| `npm run db:studio` | Explorateur Drizzle |
| `npm run db:verify` | Audite l'isolation multi-tenant |
| `npm run i18n:verify` | Vérifie que tous les catalogues ont les mêmes clés |

---

## Architecture

```
src/
  config/        Toute la configuration : env validé par zod, routes, rôles, i18n
  i18n/          Routage et chargement des traductions (next-intl)
  db/
    schema.ts    Tables + politiques RLS (source unique des migrations)
    client.ts    Pool Neon en WebSocket (transactions réelles, requises par la RLS)
    tenant.ts    withTenant() : pose app.current_org_id le temps d'une transaction
    isolation.ts Audit RLS, exécutable hors Next.js
    sync.ts      Réconciliation Clerk vers Postgres
  lib/auth.ts    Session Clerk vers contexte d'école vérifié
  proxy.ts       Clerk + next-intl (Next.js 16 a renommé middleware en proxy)
  app/[locale]/  Pages, toutes servies dans une langue explicite
messages/        Catalogues de traduction, un fichier par langue
drizzle/         Migrations SQL versionnées
```

### Isolation multi-tenant

Trois barrières superposées, de la plus fragile à la plus solide :

1. **La couche d'accès** — `withTenant(organizationId, …)` est le seul chemin
   vers les données d'école. L'identifiant vient toujours de la session Clerk
   vérifiée, jamais de l'URL ni d'un formulaire.
2. **La RLS Postgres** — chaque table porte une politique comparant son
   `organization_id` à `current_setting('app.current_org_id')`. Le paramètre est
   posé avec `is_local => true` : il meurt avec la transaction et ne peut pas
   fuir vers la requête suivante servie par la même connexion du pool. Hors
   contexte, la comparaison porte sur NULL — donc zéro ligne, jamais toutes.
3. **Le rôle de connexion** — l'application se connecte avec un rôle dépourvu de
   `BYPASSRLS` et sans aucun droit DDL. Il ne peut donc pas retirer une
   politique, ni l'ignorer.

La migration `0001_force_row_level_security.sql` applique
`FORCE ROW LEVEL SECURITY` : sans elle, le propriétaire d'une table serait
exempté de ses propres politiques.

> Ces trois barrières ne se remplacent pas. Écarter la troisième suffit à rendre
> les deux premières décoratives — c'est précisément ce qui s'est produit lors du
> premier câblage, et ce que la passe comportementale de `db:verify` a détecté.

### Ajouter une langue

1. Déposer `messages/<code>.json`.
2. Ajouter `<code>` à `NEXT_PUBLIC_SUPPORTED_LOCALES`.

Aucun fichier TypeScript à modifier. Le sens d'écriture (LTR/RTL) est déduit des
données CLDR du moteur JavaScript, donc correct d'emblée pour l'arabe ou l'hébreu.

---

## Reste à faire avant la Semaine 2

- Traduction espagnole générée par IA, à faire relire par un natif.
- Interface Clerk (connexion, création d'école) affichée en anglais quelle que
  soit la langue : la localisation Clerk demande une correspondance langue par
  langue, reportée au portail parent (Phase 4), où elle compte vraiment.
- Synchronisation Clerk vers Postgres faite à la connexion ; à remplacer par les
  webhooks Clerk une fois l'application déployée sur une URL publique.
