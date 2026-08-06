import { defineRouting } from "next-intl/routing";

import { i18nConfig } from "@/config/i18n";

/**
 * Routage internationalisé.
 *
 * Les langues proviennent de la configuration (donc de l'environnement) et non
 * d'une liste écrite ici : `defineRouting` est simplement alimenté par
 * `i18nConfig`.
 */
export const routing = defineRouting({
  locales: i18nConfig.locales,
  defaultLocale: i18nConfig.defaultLocale,
});
