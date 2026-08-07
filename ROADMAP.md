# BadgeLane — Roadmap complète, semaine par semaine

*De la première ligne de code aux premiers clients payants. Hypothèses : solo, temps plein, build assisté par IA. Stack : Next.js + Neon + Drizzle + Clerk + Tailwind/shadcn + Stripe Connect + Vercel. Domaine : badgelane.com ✅*

---

## Vue d'ensemble (4 phases, ~16 semaines)

| Phase | Semaines | Objectif |
|---|---|---|
| **A — Build MVP** | 1 → 11 | Construire le produit cœur |
| **B — Durcir & bêta** | 12 → 13 | Sécuriser + 1-3 écoles réelles |
| **C — Lancer** | 14 → 15 | Site public + acquisition |
| **D — Premiers clients & croissance** | 16 → ∞ | Convertir, itérer, grossir |

**Deux volets en parallèle :** 90 % de ton temps sur le **build**, mais garde un **mince fil business** actif dès la semaine 1 (une landing page qui collecte des emails) pour ne pas arriver au lancement sans audience.

**Réalisme :** l'IA t'accélère énormément sur le CRUD, mais paiements, sécurité et cas limites prennent toujours plus de temps que prévu. Si une semaine déborde, c'est normal — garde le cap sur l'ordre, pas sur les dates exactes.

---

## PHASE A — Build MVP

### Semaine 1 — Fondations
🎯 Un squelette déployé, multi-tenant, où on peut créer une école et se connecter.
🛠️ Repo + Next.js/TS + Tailwind/shadcn · Neon + Drizzle · Clerk (Organizations = écoles + rôles) · **next-intl câblé dès maintenant (en/es)** · scaffolding multi-tenant (`organization_id` + couche scopée) · déploiement Vercel · Sentry.
📣 Réserve les handles sociaux BadgeLane · mets une **landing page 1 page** (badgelane.com) avec la promesse + un champ email « accès anticipé » · active l'auto-renouvellement du domaine.
✅ *Done :* tu t'inscris, crées une école, te connectes, vois un dashboard vide — en ligne.

### Semaine 2 — Écoles, staff & curriculum
🎯 Modéliser l'offre d'une école.
🛠️ Tables org/user/rôles, location, program, level, skill · CRUD admin du curriculum (programmes → niveaux → compétences) · gestion staff + rôles (owner/admin/coach).
✅ *Done :* tu peux créer un programme « Learn to Swim » avec ses niveaux et compétences, et inviter un coach.

### Semaine 3 — Familles & élèves
🎯 Gérer les clients.
🛠️ Tables family/guardian/student · fiches famille (contacts, **langue préférée**, facturation) · fiches élève (niveau, notes médicales, historique) · CRUD complet.
✅ *Done :* tu peux ajouter une famille avec 2 enfants.

### Semaine 4 — Planning & classes
🎯 Le calendrier des cours récurrents.
🛠️ Table klass · grille hebdo · création/édition (niveau, lieu, horaire, capacité, coach) · terms/sessions · **job de génération des occurrences datées**.
✅ *Done :* tu crées une classe récurrente du mardi 17h, elle apparaît au planning avec ses occurrences.

### Semaine 5 — Inscriptions & liste d'attente
🎯 Remplir les classes.
🛠️ Enrollment (élève ↔ classe) · contrôle de capacité · waitlist avec position · déplacement d'une classe à l'autre.
✅ *Done :* tu inscris un élève, et le suivant passe en liste d'attente quand c'est complet.

### Semaine 6 — App coach & présence
🎯 L'outil du bord du bassin.
🛠️ Vue coach mobile-first (PWA) · « mes cours du jour » + roster · **présence en un tap** (présent/absent/excusé) · tolérance hors-ligne basique.
✅ *Done :* un coach fait l'appel sur tablette.

### Semaine 7 — Progression par badges ⭐ (ton wedge)
🎯 La fonctionnalité qui te distingue.
🛠️ Table skill_progress · le coach coche les compétences acquises d'un niveau · affichage niveau + badges sur la fiche élève.
✅ *Done :* le coach valide « flotte 5 s », ça s'affiche en badge sur le profil de l'enfant.

### Semaine 8 — Facturation 1 : Stripe Connect ⭐
🎯 L'argent rentre (mode test).
🛠️ Onboarding école → **Stripe Connect Standard** (l'école = marchand) · tuition_plans (Stripe Prices) · subscriptions · **webhooks** (invoice paid/failed) · miroir factures.
✅ *Done :* une école connecte son Stripe, une famille s'abonne, le prélèvement récurrent fonctionne en test.

### Semaine 9 — Facturation 2 : relances & paiement parent ⭐
🎯 Récupérer les paiements ratés automatiquement.
➕ **Fast-follow S8** : facturation au trimestre / à la session (paiement unique
d'avance). Beaucoup d'écoles de natation facturent ainsi plutôt qu'au mois. Ce
n'est **pas** un abonnement récurrent : à construire via les *Invoices*
ponctuelles de Stripe, pas les *Subscriptions* — d'où le report de
`tuition_plan.interval = term` hors de la Semaine 8.
🛠️ **Dunning : celui de Stripe, pas le nôtre** (décision, voir ci-dessous) ·
gestion du moyen de paiement côté parent (**Stripe Customer Portal**) ·
affichage des impayés dans la vue Facturation admin.
✅ *Done :* un paiement échoué déclenche seul la relance + le lien pour repayer.

> **Décision — on ne construit ni cron ni fournisseur d'envoi pour le MVP.**
>
> Stripe relance déjà tout seul : *Smart Retries* et e-mails automatiques sur
> les abonnements, rappels avant et après échéance sur les factures ponctuelles.
> Tout cela se règle dans le tableau de bord Stripe, pas dans le code.
>
> Comme l'école est le marchand (Connect Standard), ces messages partent **en son
> nom**. Ce n'est pas un contournement : c'est la conséquence directe du modèle
> choisi en Semaine 8.
>
> Le « text-to-pay » existe déjà — c'est `hosted_invoice_url`, que nous
> reflétons et que les rappels de Stripe incluent.
>
> Le périmètre de BadgeLane se réduit donc à deux choses, toutes deux faites :
> refléter l'état par les webhooks (`past_due`, `open`, `uncollectible`…) et
> montrer les impayés à l'école pour qu'elle n'ait pas à ouvrir Stripe.
>
> Reste optionnel, et **pas requis pour le MVP** : des relances aux couleurs de
> BadgeLane par-dessus celles de Stripe. Si elles arrivent un jour, ce sera
> derrière une interface d'envoi, et Resend ne se branchera qu'avec les
> communications de la Semaine 10.

### Semaine 10 — Portail parent & communications
🎯 Le parent devient autonome.
🛠️ Portail parent **EN + ES** (enfants, progrès/badges, inscription, paiement) · **rattrapages self-service** (crédit + réservation d'un créneau) · email/SMS (Resend/Twilio) localisés · rappels de cours · **rapports de progression mensuels automatiques**.
✅ *Done :* un parent réserve un rattrapage seul et reçoit un rapport de progrès dans sa langue.

### Semaine 11 — Reporting, import & widget
🎯 Les outils qui convertissent un client existant.
🛠️ Dashboard reporting (CA, remplissage, impayés, rétention) · **assistant d'import CSV** (export iClassPro/Jackrabbit) · **widget d'inscription intégrable** (iframe pour le site de l'école).
✅ *Done :* tu importes un vrai CSV d'une école et le widget fonctionne sur une page de test.

---

## PHASE B — Durcir & bêta

### Semaine 12 — Sécurité, conformité & polish
🎯 Prêt pour de vraies données et de vrais paiements.
➕ **Réglages de l'école, à construire** : aucun écran ne permet aujourd'hui de
corriger le **pays**, la **devise** ou le **fuseau** d'une école — ils sont posés
à la création depuis l'environnement, et il faut une requête SQL pour les
changer. À traiter avec la règle de cohérence : *la devise suit le pays*
(FR → EUR, US → USD), par organisation. Indispensable le jour où des écoles US
et européennes coexistent sur la même instance.
🛠️ Bug bash + cas limites · **revue autorisations (rôles) + RLS Neon** · tests des flux critiques (auth, paiements, isolation tenant) · perf.
🔒 **Audit de sécurité par un dev senior** (ponctuel, quelques heures) : RLS, auth, Stripe, endpoint widget.
⚖️ Docs légaux : politique de confidentialité, **DPA** (tu es sous-traitant), flux de **consentement parental (COPPA/RGPD)**, CGV.
✅ *Done :* audit passé, docs légaux en place.

### Semaine 13 — Bêta avec 1-3 écoles réelles
🎯 Confronter le produit au réel.
🛠️ Recrute 1-3 écoles amies · **migre leurs données gratuitement** · onboarde-les · observe l'usage · corrige vite.
📣 Récolte les premiers retours + un ou deux témoignages/logos.
✅ *Done :* au moins une école gère ses vraies opérations sur BadgeLane.

---

## PHASE C — Lancer

### Semaine 14 — Préparer le lancement
🎯 Un site public qui vend et convertit en self-service.
🛠️ Landing page complète badgelane.com (promesse + « the modern **iClassPro / Jackrabbit alternative** ») · page pricing (39/79/149 $) · parcours d'inscription + **essai 14 j** · **ta propre facturation SaaS** (Stripe sur TON compte) · docs d'aide.
📣 Soumets tes fiches **Capterra / GetApp / Software Advice** (catégorie swim school / class management).
✅ *Done :* site public en ligne, inscription + essai self-service opérationnels.

### Semaine 15 — Lancement public & contenu
🎯 Ouvrir les vannes de l'acquisition (organique).
📣 Publie 2-3 articles SEO à forte intention : « best swim school software 2026 », « **iClassPro alternative** », « **Jackrabbit alternative** » · poste (valeur d'abord) dans **US Swim School Association** + groupes Facebook de propriétaires d'écoles · démarre le **cold outreach founder-led** aux écoles (offre : migration gratuite).
🛠️ Corrige les frictions d'onboarding repérées par les premiers inscrits.
✅ *Done :* lancé ; premiers leads inbound + outreach en cours.

---

## PHASE D — Premiers clients & croissance

### Semaine 16 — Convertir & itérer
🎯 Tes premiers euros récurrents.
📣 Convertis les bêta-testeurs + leads en payant · récolte témoignages/logos · demande 2 intros par client signé.
🛠️ Priorise les corrections issues du terrain (fiabilité avant features).
✅ *Done :* premiers clients payants.

### Mois 4 et au-delà — Rythme de croissance (hebdo)
Chaque semaine, en routine :
- **Contenu** : 1-2 pages SEO/comparatifs (par ville, par « vs concurrent »).
- **Outreach** : un quota d'écoles contactées + relances.
- **Support & rétention** : réponds vite (ton avantage sur les dinosaures), surveille le churn.
- **Produit** : déploie les features Phase 2 **à la demande** — remplissage auto de waitlist, parrainage, langues supplémentaires, passage auto au niveau supérieur, plus tard app native.
- **Expansion** : une fois la natation prouvée, ouvre aux activités enfants adjacentes (gym, danse, cheer) — même moteur, marché 5× plus grand (c'est le chemin de Jackrabbit).

---

## Jalons clés (à cocher)
- [ ] S1 : app déployée, multi-tenant, i18n câblé
- [ ] S7 : progression par badges fonctionnelle (le wedge)
- [ ] S9 : facturation récurrente + relances en test
- [ ] S11 : import CSV d'un vrai export concurrent réussi
- [ ] S12 : audit sécurité passé + légal en place
- [ ] S13 : 1 école réelle en production
- [ ] S14 : site public + essai self-service
- [ ] S16 : premier client payant

---

## Trois règles pour tenir le cap
1. **Ne bâcle jamais le sensible** (paiements, données enfants, isolation tenant) — c'est le seul endroit où tu ralentis volontairement.
2. **Discipline de scope** : une feature n'entre que si elle résout une plainte de l'incumbent ou aide à migrer/recruter. Le reste attend la Phase 2.
3. **Le marché paie déjà** (17 000 écoles chez Jackrabbit). Ton risque n'est pas le marché — c'est de finir et de migrer proprement. Reste concentré sur « livrer + fiabiliser + importer les données ».

---

### Prochain livrable
Je peux enchaîner sur : le **prompt de démarrage Cursor** (pour attaquer la Semaine 1), le **schéma SQL + RLS Neon**, ou une **maquette d'écran HTML**. Lequel ?
