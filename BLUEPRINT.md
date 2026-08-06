# Blueprint MVP v2 — Logiciel de gestion d'école de natation

*Version mise à jour. Conçue pour un build solo assisté par IA (Cursor/Claude Code), temps plein. À donner tel quel à ton outil IA comme cahier des charges.*
*Nouveautés v2 (marquées 🆕) : architecture i18n-ready, portail & comms parent EN/ES, rattrapages self-service, rapports de progression automatiques, relances de paiement (text-to-pay), widget d'inscription intégrable.*

---

## 0. Principe directeur (inchangé)

Tu ne refais pas iClassPro. Tu excelles sur ses 2 plus grosses faiblesses, le reste étant « suffisamment bon » :
- ⭐ **Facturation récurrente automatique et sans friction** (+ relances intelligentes) 🆕
- ⭐ **Suivi de progression du nageur par niveaux/badges** (+ rapports auto aux parents) 🆕

Trois multiplicateurs d'adoption :
- 🆕 **Rattrapages en self-service** (douleur récurrente, mal gérée partout)
- 🆕 **Widget d'inscription intégrable** sur le site de l'école (boucle de croissance)
- **Import CSV gratuit** depuis iClassPro/Jackrabbit (supprime le frein au changement)

Règle de scope : une feature n'entre que si elle **résout une plainte de l'incumbent** ou **aide à migrer/recruter un client**. Sinon → « plus tard ».

---

## 1. Périmètre MVP

### ✅ Dans le MVP
Écoles/staff · élèves & familles · programmes/niveaux/compétences · planning de cours récurrents · inscriptions + liste d'attente · présence (app coach) · **progression par compétences** · 🆕 **rapports de progression auto** · **facturation récurrente Stripe** + 🆕 **relances/text-to-pay** · portail parent · 🆕 **rattrapages self-service** · 🆕 **widget d'inscription intégrable** · notifications email/SMS · reporting simple · **import CSV** · 🆕 **architecture i18n-ready + portail/comms parent EN + ES**.

### ⏸️ Après les premiers clients payants
Interface admin/coach multilingue · remplissage auto de la liste d'attente · passage auto au niveau supérieur · vidéos de compétences · parrainage familial · planning/paie coachs · app native · avis Google auto · marketplace de découverte · compétitions.

---

## 2. Internationalisation — le principe transversal 🆕

**Décision :** l'app supporte un **nombre ILLIMITÉ de langues** par design (i18n-ready dès la 1ʳᵉ ligne), avec une **activation progressive** : tu lances en anglais + espagnol côté parent, puis tu ajoutes FR/DE/PT/NL… **à la demande** (quand un client ou un marché le justifie). Ajouter une langue = ajouter un fichier de traduction, sans toucher au code.

**Le coût n'est pas technique mais humain :** le code est gratuit ; ce qui coûte, c'est la *traduction* (1ʳᵉ passe IA + relecture native, ou outil type Tolgee/Crowdin) et le *support client* dans la langue. → n'ouvre une langue que quand tu es prêt à la servir.

**Deux couches de langue à ne pas confondre :**
1. *Textes de l'app* (menus, boutons, emails types) → traduits par TOI, une fois, dans les fichiers de langue. Illimité, cheap.
2. *Contenu propre de l'école* (noms de cours, niveaux, compétences) → saisi par l'ÉCOLE dans sa langue. Tu ne le traduis pas. (Contenu multi-langue au sein d'une même école = table de traductions, hors MVP.)

Règles concrètes à donner à l'IA :
- **Aucune chaîne de texte en dur.** Tous les libellés passent par une lib d'i18n (**next-intl** recommandé), dans des fichiers de traduction (`en.json`, `es.json`, `fr.json`, …).
- **Priorité de traduction :** *Interface admin/coach* → EN au lancement (ta cible achète en anglais) ; *Portail parent + emails + SMS* → EN + ES dès le lancement, puis autres langues à la demande. C'est le côté parent qui rapporte le plus tôt.
- **Champ `preferred_language`** sur `guardian`/`family` + **`supported_languages`** sur `organization` → chaque parent reçoit tout dans sa langue, chaque école active les siennes.
- Formats de **date, heure, devise** localisés (Intl API). **Support RTL** (arabe/hébreu) à anticiper dans la structure CSS, à activer plus tard.

Coût : quasi nul si fait dès le départ ; énorme si rétro-ajouté. D'où « dès le jour 1 ».

---

## 3. Modèle de données

**Règle d'or multi-tenant :** chaque table métier porte `organization_id`, filtré en requête **et** protégé par RLS (voir §6).

### Entités & champs clés

**organization** (l'école = tenant)
`id, name, timezone, currency, country, stripe_account_id, public_booking_enabled 🆕, settings(jsonb), created_at`

**user** (staff : owner / admin / coach)
`id, organization_id, email, full_name, role[owner|admin|coach], auth_id, active`

**location** — `id, organization_id, name, address`

**program** — `id, organization_id, name, description`

**level** — `id, organization_id, program_id, name, sort_order, color`

**skill** — `id, organization_id, level_id, name, description, sort_order`

**klass** (cours récurrent — table `klass`, "class" est réservé)
`id, organization_id, program_id, level_id, location_id, instructor_id, title, day_of_week, start_time, duration_min, capacity, term_id, active, public_bookable 🆕`

**term** — `id, organization_id, name, start_date, end_date, enrollment_open`

**class_occurrence** (instance datée, pour présence & rattrapages)
`id, organization_id, klass_id, date, status[scheduled|cancelled], open_makeup_slots 🆕`

**family** (compte foyer = facturation + login parent)
`id, organization_id, primary_guardian_name, email, phone, preferred_language 🆕, stripe_customer_id, billing_status`

**guardian** — `id, organization_id, family_id, name, email, phone, preferred_language 🆕, auth_id(nullable)`

**student** (le nageur — enfant)
`id, organization_id, family_id, first_name, last_name, date_of_birth, current_level_id, medical_notes(minimal), photo_url(optionnel)`

**enrollment** — `id, organization_id, student_id, klass_id, status[active|paused|ended|waitlisted], start_date, end_date`

**waitlist_entry** — `id, organization_id, student_id, klass_id, position, created_at`

**attendance** — `id, organization_id, class_occurrence_id, student_id, status[present|absent|excused|makeup], marked_by, marked_at`

**makeup_credit** 🆕 (crédit de rattrapage, réservable par le parent)
`id, organization_id, student_id, reason, status[available|booked|used|expired], expires_at, booked_occurrence_id`

**skill_progress** ⭐ — `id, organization_id, student_id, skill_id, status[not_started|in_progress|achieved], achieved_at, coach_id`

**tuition_plan** — `id, organization_id, name, amount, interval[weekly|monthly|term], stripe_price_id`

**subscription** (miroir Stripe) — `id, organization_id, family_id, tuition_plan_id, stripe_subscription_id, status, current_period_end`

**invoice / payment** (miroir Stripe, lecture seule) — `id, organization_id, family_id, stripe_invoice_id, amount, status[paid|open|past_due|failed], due_date, paid_at, retry_count 🆕`

**message_log** — `id, organization_id, family_id, channel[email|sms], template, language 🆕, sent_at, status`

**audit_log** — `id, organization_id, user_id, action, entity, entity_id, meta(jsonb), created_at`

### Relations clés
`organization 1—N user/location/program/family/klass` · `family 1—N student/guardian` · `student N—N klass` (via `enrollment`) · `level 1—N skill` · `student N—N skill` (via `skill_progress`) · `family 1—1 subscription` (MVP).

---

## 4. Écrans & parcours (3 interfaces + 1 widget, 1 seule base de code)

### A. Console Admin / Owner (desktop web, EN)
1. **Dashboard** — cours du jour, remplissage, CA du mois, **impayés/paiements échoués**, nouvelles inscriptions.
2. **Planning** — grille hebdo ; créer/éditer (niveau, lieu, horaire, capacité, coach) ; annuler une occurrence ; 🆕 marquer une classe `public_bookable`.
3. **Inscriptions & liste d'attente**.
4. **Élèves & familles** — fiche famille (contacts, 🆕 langue préférée, facturation), fiche élève (niveau, progression, notes médicales, historique).
5. **Curriculum** — programmes → niveaux → compétences.
6. **Facturation** ⭐ — plans, abonnements, factures, 🆕 **vue paiements échoués + relances auto (dunning)**, lien portail Stripe.
7. **Reporting** — CA, remplissage, présence, rétention, impayés.
8. **Communication** — envoi email/SMS, modèles 🆕 **bilingues (EN/ES)**.
9. **Réglages** — lieux, staff & rôles, termes, plans tarifaires, connexion Stripe, 🆕 **widget d'inscription (code d'intégration)**.
10. **Import** ⭐ — assistant CSV depuis iClassPro/Jackrabbit.

### B. App Coach (web mobile-first / PWA, au bord du bassin, EN)
1. **Mes cours du jour** + roster.
2. **Présence** — check-in en un tap.
3. ⭐ **Progression** — cocher les compétences acquises (gros boutons, tolérant hors-ligne).
4. **Notes** rapides.

### C. Portail Parent (web mobile-first, 🆕 EN + ES)
1. **Mes enfants** — niveau + **badges/compétences acquises**.
2. **Inscription** — parcourir/s'inscrire, rejoindre une liste d'attente.
3. 🆕 **Rattrapages self-service** — signaler une absence → obtenir un crédit → **réserver un créneau de rattrapage** parmi les occurrences avec places (consomme le `makeup_credit`). Zéro appel téléphonique.
4. **Paiement** ⭐ — carte enregistrée, factures, 🆕 **payer une facture échouée en un lien (text-to-pay)**, via Stripe Customer Portal.
5. **Messages / notifications** (dans la langue du parent).

### D. 🆕 Widget d'inscription intégrable (public)
Un bout de code `<iframe>`/script que l'école colle sur son propre site : le visiteur voit les classes `public_bookable`, choisit, crée un compte famille et s'inscrit (paiement en ligne). → l'école recrute via son site, toi tu deviens indispensable. Endpoint public sécurisé, scopé par `organization_id`, sans exposer les données privées.

---

## 5. Automatisations clés (jobs planifiés) 🆕

Elles portent une grande partie de la valeur — via Inngest/Trigger.dev ou cron Supabase :
- **Génération des occurrences** de cours à partir de la récurrence.
- **Rappels de cours** (email/SMS J-1) dans la langue du parent.
- ⭐ **Relances de paiement (dunning)** : à chaque `invoice.payment_failed`, séquence automatique (J0, J+2, J+5) avec **lien text-to-pay**, puis alerte admin. Récupère du CA directement.
- 🆕 **Rapports de progression mensuels** : email auto au parent listant les compétences validées ce mois-ci (+ badge). Moteur de rétention et de bouche-à-oreille.
- **Expiration des crédits de rattrapage**.

---

## 6. Stack (optimisée build IA-assisté)

Tout en **TypeScript**, un repo, un langage.

| Couche | Choix | Pourquoi |
|---|---|---|
| App (front + back) | **Next.js (App Router) + TS** | Full-stack, très bien maîtrisé par l'IA |
| UI | **Tailwind + shadcn/ui** | Génération IA excellente, look moderne |
| 🆕 i18n | **next-intl** | Externalise tous les textes EN/ES dès le départ |
| Base de données | **Postgres via Neon** | Free tier généreux (**100 projets**, pas de « 2ᵉ projet payant »), serverless |
| Auth | **Clerk (Organizations)** — ou **Better Auth** si tu veux tout posséder | Clerk : chaque école = une Organization + rôles intégrés, **gratuit jusqu'à 50 000 utilisateurs actifs** · Better Auth : open-source, zéro coût/utilisateur, données chez toi |
| Accès data | **Drizzle** | Typage TS bout en bout, migrations claires |
| Stockage fichiers | **Cloudflare R2 / Vercel Blob / UploadThing** | Photos élèves, documents — free tier suffisant |
| Paiements ⭐ | **Stripe Connect (Standard) + Billing** | Chaque école = son marchand → tu ne touches ni cartes ni fonds, hors PCI et hors risque remboursement |
| Jobs planifiés | **Inngest / Trigger.dev** | Rappels, dunning, rapports, occurrences |
| Email / SMS | **Resend** + **Twilio** | APIs simples, bien documentées |
| Hébergement | **Vercel** + **Supabase** | Déploiement en une commande |
| Erreurs / analytics | **Sentry** + **PostHog** | Bugs & usage dès J1 |

> **Paiements :** en **Stripe Connect Standard**, la tuition va du parent → au compte Stripe de l'école (l'école est le marchand : elle porte remboursements/litiges). Ton abonnement SaaS est prélevé séparément sur TON compte Stripe. Résultat : PCI, responsabilité des remboursements et gros du risque juridique évacués.

---

## 7. Sécurité & conformité (à ne pas bâcler)

Paiements + données d'enfants = deux zones sensibles.

- **Isolation multi-tenant (priorité n°1)** : `organization_id` partout + **couche d'accès data strictement scopée par org** (chaque requête injecte l'org de l'utilisateur, via l'Organization Clerk). En filet de sécurité, active **Postgres RLS directement sur Neon** avec un contexte de session (`SET LOCAL app.org_id`) — même protection que le RLS Supabase, sans Supabase. → **à faire auditer par un humain.**
- 🆕 **Widget public** : endpoint dédié, lecture seule des données publiques (classes bookables), jamais d'accès aux données privées ; rate-limité.
- **Autorisation** : rôles owner/admin/coach/parent vérifiés **côté serveur**.
- **Données d'enfants (COPPA US <13, RGPD/RGPD-K UE)** : minimisation, consentement parental, pas de marketing enfants, chiffrement au repos + TLS, DPA (tu es sous-traitant), politique de confidentialité. Hébergement UE si tu vises l'Europe.
- **Paiements** : jamais de carte chez toi (Stripe Elements/Checkout + Connect).
- **Hygiène** : secrets en variables d'env, least privilege, rate limiting login/inscription/widget, `audit_log`, sauvegardes DB.
- **Un seul recours humain** : audit de sécurité ponctuel (RLS, auth/permissions, Stripe, endpoint widget) **avant** d'ouvrir aux vrais paiements/données.

---

## 8. Séquence de build (temps plein + IA ≈ 9-13 semaines)

**Phase 0 — Fondations (3-5 j)** : Next.js + Tailwind/shadcn, **Neon + Drizzle**, **Clerk (ou Better Auth)**, scaffolding **multi-tenant (org_id + couche scopée + RLS Neon)**, 🆕 **next-intl multi-langue câblé dès maintenant**, Vercel, Sentry.

**Phase 1 — Cœur métier (2-3 sem)** : écoles/staff/rôles · familles (+ langue préférée) & élèves · programmes/niveaux/compétences · planning · inscriptions + liste d'attente.

**Phase 2 — Progression & coach (2 sem)** ⭐ : occurrences · app coach (roster, présence, cocher compétences).

**Phase 3 — Facturation (2 sem)** ⭐ : Stripe Connect (onboarding école) · plans de tuition · abonnements · webhooks · 🆕 **dunning + text-to-pay**.

**Phase 4 — Portail parent & comms (2-3 sem)** : portail EN/ES (progrès, inscription, **rattrapages self-service** 🆕, paiement) · notifications email/SMS localisées · rappels · 🆕 **rapports de progression mensuels auto**.

**Phase 5 — Widget, reporting & import (2 sem)** : 🆕 **widget d'inscription intégrable** · dashboard reporting · **import CSV** (migration).

**Phase 6 — Durcissement & bêta (1-2 sem)** : **audit sécurité humain** · tests des flux critiques · bêta 1-3 écoles · corrections · lancement payant.

---

## 9. Checklist de mise en production
- [ ] RLS testées (aucun tenant ne voit un autre) — **audité humain**
- [ ] Autorisations serveur par rôle (coach/parent/admin)
- [ ] 🆕 Endpoint widget public verrouillé (lecture seule, rate-limité)
- [ ] Stripe Connect live + webhooks signés + **dunning/text-to-pay** testés
- [ ] 🆕 Comms EN/ES vérifiées (portail, emails, SMS) selon `preferred_language`
- [ ] Consentement parental + politique de confidentialité + DPA
- [ ] Sauvegardes DB + restauration testée
- [ ] Sentry + `audit_log` + rate limiting actifs
- [ ] Import CSV validé sur un vrai export iClassPro/Jackrabbit
- [ ] Essai 14 j + parcours d'abonnement SaaS (ton Stripe) opérationnel

---

## 10. Ce qui fait gagner (rappel)
1. **Facturation auto + relances** → résout la plainte n°1 et récupère du CA.
2. **Progression par badges + rapports auto** → rétention et bouche-à-oreille.
3. **Rattrapages self-service** → supprime une corvée quotidienne.
4. **Widget d'inscription** → aide l'école à recruter (boucle de croissance).
5. **Import gratuit** → supprime le frein au changement.
6. **EN/ES côté parent** → différenciateur local (marché US hispanophone) à coût quasi nul grâce à l'i18n-ready.

Le marché paie déjà (17 000 écoles chez Jackrabbit, des milliers chez iClassPro). Risque de marché ≈ nul ; tout est dans l'exécution : produit fiable + migration + support. Exactement ce que tu voulais.

---

### Prochaine étape
Je peux générer : (a) le **schéma SQL complet** (tables + RLS Supabase) prêt à coller · (b) un **prompt de démarrage Cursor** structuré · (c) une **maquette d'écran HTML** (dashboard, app coach ou portail parent). Dis-moi lequel.
