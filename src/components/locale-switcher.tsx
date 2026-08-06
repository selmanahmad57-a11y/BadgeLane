import { i18nConfig, languageName } from "@/config/i18n";

import { LocaleSwitcherLinks } from "./locale-switcher-links";

/**
 * Bascule entre les langues actives, en restant sur la page courante.
 *
 * Composant serveur : c'est ici, et seulement ici, que les noms de langues sont
 * calculés. `Intl.DisplayNames` s'appuie sur les données CLDR embarquées dans le
 * moteur JavaScript — or Node et les navigateurs n'en embarquent pas la même
 * version. Appelée des deux côtés, la fonction rend « español » sur le serveur
 * et « Español » dans Chrome : une divergence d'hydratation.
 *
 * Les libellés sont donc résolus une fois, côté serveur, puis transmis en
 * propriétés. Le navigateur se contente d'afficher ce qu'il reçoit.
 */
export function LocaleSwitcher() {
  /** Un sélecteur à une seule option n'a rien à sélectionner. */
  if (i18nConfig.locales.length < 2) return null;

  const options = i18nConfig.locales.map((locale) => ({
    locale,
    label: languageName(locale),
  }));

  return <LocaleSwitcherLinks options={options} />;
}
