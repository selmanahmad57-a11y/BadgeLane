"use client";

import { useLocale, useTranslations } from "next-intl";

import { i18nConfig, languageName } from "@/config/i18n";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Bascule entre les langues actives, en restant sur la page courante.
 *
 * Construit à partir de vrais liens plutôt que d'un menu piloté en JavaScript :
 * chaque langue a ainsi sa propre URL, indexable, partageable, et fonctionnelle
 * avant même que le JavaScript ne soit chargé.
 *
 * `usePathname` vient de next-intl : il renvoie le chemin *sans* préfixe de
 * langue, que `Link` re-préfixe ensuite avec la langue visée. Changer de langue
 * depuis `/es/dashboard` mène donc à `/en/dashboard`, et non à l'accueil.
 */
export function LocaleSwitcher() {
  const pathname = usePathname();
  const currentLocale = useLocale();
  const t = useTranslations("localeSwitcher");

  /** Un sélecteur à une seule option n'a rien à sélectionner. */
  if (i18nConfig.locales.length < 2) return null;

  return (
    <nav aria-label={t("label")} className="flex items-center gap-1">
      {i18nConfig.locales.map((locale) => {
        const isCurrent = locale === currentLocale;

        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            /**
             * `aria-current` annonce la langue active aux lecteurs d'écran ;
             * `lang` indique au synthétiseur vocal de prononcer « Español » en
             * espagnol plutôt que de le lire à l'anglaise.
             */
            aria-current={isCurrent ? "true" : undefined}
            lang={locale}
            className={cn(
              "rounded-md px-2 py-1 text-sm transition-colors",
              isCurrent
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {languageName(locale)}
          </Link>
        );
      })}
    </nav>
  );
}
