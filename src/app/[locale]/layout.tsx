import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { clientEnv } from "@/config/env.client";
import { textDirection } from "@/config/i18n";
import { localizedPath, routes } from "@/config/routes";
import { routing } from "@/i18n/routing";

import "../globals.css";

/**
 * Layout racine de l'application. Il vit sous `[locale]` : toute page est donc
 * servie dans une langue explicite, présente dans l'URL.
 */

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/** Pré-rend une variante par langue activée, sans énumérer les langues ici. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: Omit<LocaleLayoutProps, "children">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  /**
   * Une langue absente de la configuration ne doit pas rendre une page à moitié
   * traduite : elle n'existe simplement pas.
   */
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  /** Autorise le rendu statique des pages qui n'ont pas besoin de la requête. */
  setRequestLocale(locale);

  return (
    <ClerkProvider
      publishableKey={clientEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      /**
       * Les URL Clerk sont dérivées de la configuration de routes et préfixées
       * de la langue courante : l'authentification ne fait pas sortir de la
       * langue choisie par le visiteur.
       */
      signInUrl={localizedPath(locale, routes.signIn)}
      signUpUrl={localizedPath(locale, routes.signUp)}
      signInFallbackRedirectUrl={localizedPath(locale, routes.dashboard)}
      signUpFallbackRedirectUrl={localizedPath(locale, routes.dashboard)}
      afterSignOutUrl={localizedPath(locale, routes.home)}
    >
      <html
        lang={locale}
        dir={textDirection(locale)}
        className={`${sans.variable} ${mono.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="flex min-h-full flex-col">
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
