"use client";

import { useTranslations } from "next-intl";

import { CONSOLE_NAVIGATION, stripLocalePrefix } from "@/config/routes";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Navigation principale de la console d'administration.
 *
 * Les entrées viennent de `CONSOLE_NAVIGATION` : ajouter un écran se fait dans
 * la configuration des routes, pas ici. Composant client uniquement parce qu'il
 * doit connaître le chemin courant pour marquer l'onglet actif.
 */
export function ConsoleNav() {
  const pathname = usePathname();
  const t = useTranslations("navigation");

  return (
    <nav aria-label={t("label")} className="flex flex-wrap items-center gap-1">
      {CONSOLE_NAVIGATION.map(({ route, messageKey }) => {
        /**
         * `usePathname` de next-intl renvoie déjà un chemin sans préfixe de
         * langue ; `stripLocalePrefix` le rend robuste si ce n'était pas le cas.
         */
        const current = stripLocalePrefix(pathname);
        const isActive = current === route || current.startsWith(`${route}/`);

        return (
          <Link
            key={route}
            href={route}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(messageKey)}
          </Link>
        );
      })}
    </nav>
  );
}
