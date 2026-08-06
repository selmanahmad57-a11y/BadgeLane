import { Show } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { Link } from "@/i18n/navigation";

type LandingPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function LandingPage({ params }: LandingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing");
  const brand = await getTranslations("brand");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl space-y-8">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {brand("name")}
        </p>

        <h1 className="font-heading text-4xl leading-tight font-semibold text-balance sm:text-5xl">
          {t("heading")}
        </h1>

        <p className="text-muted-foreground text-lg text-pretty">{t("body")}</p>

        <div className="flex flex-wrap gap-3">
          {/*
            Ces éléments naviguent : ce sont des liens, pas des boutons. On leur
            applique donc l'apparence d'un bouton via `buttonVariants` plutôt
            que de faire rendre un `<a>` par le composant Button — lequel
            supprimerait la sémantique native attendue par les lecteurs d'écran
            et la navigation au clavier.

            `Show` remplace `SignedIn`/`SignedOut` depuis Clerk v7.
          */}
          <Show when="signed-out">
            <Link href={routes.signUp} className={buttonVariants()}>
              {t("signUp")}
            </Link>
            <Link
              href={routes.signIn}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("signIn")}
            </Link>
          </Show>

          <Show when="signed-in">
            <Link href={routes.dashboard} className={buttonVariants()}>
              {t("openDashboard")}
            </Link>
          </Show>
        </div>
      </div>
    </main>
  );
}
