import { i18nConfig, localeFromPathname, type Locale } from "./i18n";

/**
 * Chemins de l'application, sans préfixe de langue.
 *
 * Ces valeurs reflètent l'arborescence de `src/app/[locale]/` : ce sont des
 * identifiants de routes, pas des réglages de déploiement — les mettre en
 * variable d'environnement les désynchroniserait du routeur de fichiers. Elles
 * sont donc centralisées ici, et référencées partout ailleurs via ce module.
 */
export const routes = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  createOrganization: "/create-organization",
  dashboard: "/dashboard",
  today: "/today",
  families: "/families",
  schedule: "/schedule",
  terms: "/terms",
  curriculum: "/curriculum",
  locations: "/locations",
  staff: "/staff",
} as const;

/** Chemin d'une fiche famille. */
export function familyPath(familyId: string): string {
  return `${routes.families}/${familyId}`;
}

/** Chemin d'une fiche élève, toujours sous sa famille. */
export function studentPath(familyId: string, studentId: string): string {
  return `${familyPath(familyId)}/students/${studentId}`;
}

export type AppRoute = (typeof routes)[keyof typeof routes];

/**
 * Routes exigeant une session authentifiée. Tout le reste est public.
 * Consommé par `src/proxy.ts`.
 */
export const AUTHENTICATED_ROUTES: readonly AppRoute[] = [
  routes.createOrganization,
  routes.dashboard,
  routes.today,
  routes.families,
  routes.schedule,
  routes.terms,
  routes.curriculum,
  routes.locations,
  routes.staff,
];

/**
 * Routes exigeant en plus une organisation active (une école sélectionnée).
 * Sous-ensemble de `AUTHENTICATED_ROUTES`.
 */
export const ORGANIZATION_SCOPED_ROUTES: readonly AppRoute[] = [
  routes.dashboard,
  routes.today,
  routes.families,
  routes.schedule,
  routes.terms,
  routes.curriculum,
  routes.locations,
  routes.staff,
];

/** Entrées de la navigation principale de la console d'administration. */
export const CONSOLE_NAVIGATION = [
  { route: routes.dashboard, messageKey: "dashboard" },
  { route: routes.today, messageKey: "today" },
  { route: routes.families, messageKey: "families" },
  { route: routes.schedule, messageKey: "schedule" },
  { route: routes.terms, messageKey: "terms" },
  { route: routes.curriculum, messageKey: "curriculum" },
  { route: routes.locations, messageKey: "locations" },
  { route: routes.staff, messageKey: "staff" },
] as const;

/**
 * Paramètre de requête portant la destination d'origine lors d'une redirection
 * vers la connexion. Nom imposé par Clerk, qui le relit après authentification.
 */
export const SIGN_IN_REDIRECT_PARAM = "redirect_url";

/** Préfixe un chemin applicatif de la langue courante : `/dashboard` -> `/en/dashboard`. */
export function localizedPath(locale: Locale, path: AppRoute): string {
  return path === routes.home ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Retire le préfixe de langue d'un chemin : `/en/dashboard` -> `/dashboard`.
 * Un chemin sans préfixe reconnu est renvoyé tel quel.
 */
export function stripLocalePrefix(pathname: string): string {
  const locale = localeFromPathname(pathname);
  if (!locale) return pathname;

  const withoutLocale = pathname.slice(`/${locale}`.length);
  return withoutLocale === "" ? routes.home : withoutLocale;
}

/**
 * Le chemin demandé exige-t-il une session ?
 *
 * Implémenté ici plutôt qu'avec `createRouteMatcher` de Clerk, déprécié au
 * profit des contrôles côté ressource. Le contrôle faisant autorité reste
 * `requireOrganizationSession()` dans la page ; celui-ci ne sert qu'à éviter un
 * aller-retour inutile et à rediriger dans la bonne langue.
 */
export function isAuthenticatedPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);

  return AUTHENTICATED_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
}

/** Chemin de repli lorsqu'aucune langue n'est connue (ex. redirection depuis la racine). */
export function defaultLocalePath(path: AppRoute): string {
  return localizedPath(i18nConfig.defaultLocale, path);
}
