import { clerkMiddleware } from "@clerk/nextjs/server";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";

import { i18nConfig, localeFromPathname } from "@/config/i18n";
import {
  isAuthenticatedPath,
  localizedPath,
  routes,
  SIGN_IN_REDIRECT_PARAM,
} from "@/config/routes";
import { routing } from "@/i18n/routing";

/**
 * Proxy applicatif — anciennement `middleware.ts` : Next.js 16 a renommé le
 * fichier et la fonction, le comportement est inchangé.
 *
 * Deux responsabilités enchaînées :
 *  1. Clerk résout la session et bloque les routes privées ;
 *  2. next-intl négocie la langue et préfixe l'URL.
 *
 * L'ordre compte : la redirection vers la connexion doit conserver la langue
 * demandée, ce qui suppose de la lire avant que next-intl ne réécrive l'URL.
 */
const handleInternationalization = createIntlMiddleware(routing);

/**
 * Les routes d'API n'ont pas de langue.
 *
 * Sans cette sortie, next-intl redirigerait `/api/stripe/webhook` vers
 * `/en/api/stripe/webhook` : Stripe recevrait une redirection au lieu d'un 200,
 * retenterait, et finirait par désactiver l'endpoint. Le webhook aurait été
 * cassé avant d'exister.
 */
const API_PREFIX = "/api/";

export default clerkMiddleware(async (auth, request) => {
  if (request.nextUrl.pathname.startsWith(API_PREFIX)) {
    return NextResponse.next();
  }

  if (isAuthenticatedPath(request.nextUrl.pathname)) {
    const { userId } = await auth();

    if (!userId) {
      const locale =
        localeFromPathname(request.nextUrl.pathname) ?? i18nConfig.defaultLocale;

      const signInUrl = new URL(
        localizedPath(locale, routes.signIn),
        request.url,
      );
      signInUrl.searchParams.set(
        SIGN_IN_REDIRECT_PARAM,
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );

      return NextResponse.redirect(signInUrl);
    }
  }

  return handleInternationalization(request);
});

export const config = {
  matcher: [
    /**
     * Tout sauf les ressources internes de Next.js et les fichiers statiques —
     * les faire transiter par Clerk et next-intl serait du coût pur.
     */
    "/((?!_next|.*\\.[\\w]+$).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
