import { Show } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
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
          {/* `Show` remplace `SignedIn`/`SignedOut` depuis Clerk v7. */}
          <Show when="signed-out">
            {/*
              Base UI compose via `render` (et non `asChild`) : le bouton rend
              le lien localisé tout en conservant ses styles et sa sémantique.
            */}
            <Button render={<Link href={routes.signUp} />}>
              {t("signUp")}
            </Button>
            <Button variant="outline" render={<Link href={routes.signIn} />}>
              {t("signIn")}
            </Button>
          </Show>

          <Show when="signed-in">
            <Button render={<Link href={routes.dashboard} />}>
              {t("openDashboard")}
            </Button>
          </Show>
        </div>
      </div>
    </main>
  );
}
