import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

/**
 * Charge le catalogue de traductions correspondant à la langue de la requête.
 *
 * L'import est dynamique et paramétré par la langue : déposer
 * `messages/<code>.json` et ajouter `<code>` à `NEXT_PUBLIC_SUPPORTED_LOCALES`
 * suffit à activer une langue, sans modifier ce fichier.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
