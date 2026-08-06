"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type LocaleOption = {
  locale: string;
  /**
   * Nom de la langue, déjà résolu côté serveur. Ne jamais le recalculer ici :
   * les données CLDR du navigateur diffèrent de celles du serveur, ce qui
   * provoquerait une divergence d'hydratation.
   */
  label: string;
};

/**
 * Rendu des liens de langue. Composant client uniquement parce qu'il a besoin du
 * chemin courant, que seul le routeur connaît côté navigateur.
 *
 * Ce sont de vrais liens, pas un menu piloté en JavaScript : chaque langue garde
 * une URL propre, indexable et partageable, et la bascule fonctionne avant même
 * que le JavaScript ne soit chargé.
 *
 * `usePathname` vient de next-intl et renvoie le chemin *sans* préfixe de
 * langue, que `Link` re-préfixe ensuite. Changer de langue depuis
 * `/es/dashboard` mène donc à `/en/dashboard`, et non à l'accueil.
 */
export function LocaleSwitcherLinks({
  options,
}: {
  options: readonly LocaleOption[];
}) {
  const pathname = usePathname();
  const currentLocale = useLocale();
  const t = useTranslations("localeSwitcher");

  return (
    <nav aria-label={t("label")} className="flex items-center gap-1">
      {options.map(({ locale, label }) => {
        const isCurrent = locale === currentLocale;

        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            /**
             * `aria-current` annonce la langue active aux lecteurs d'écran ;
             * `lang` indique au synthétiseur vocal de prononcer « español » en
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
