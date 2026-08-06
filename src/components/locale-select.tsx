import { i18nConfig, languageName } from "@/config/i18n";
import { cn } from "@/lib/utils";

/** Styles d'un `<select>` natif, alignés sur ceux du composant Input. */
export const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * Choix de la langue de correspondance d'une famille ou d'un tuteur.
 *
 * Les options viennent des langues activées : ouvrir une langue supplémentaire
 * la rend disponible ici sans toucher au code. Les libellés sont résolus côté
 * serveur — `Intl.DisplayNames` s'appuie sur des données CLDR qui diffèrent
 * entre Node et les navigateurs, et les calculer des deux côtés provoquerait
 * une divergence d'hydratation.
 *
 * Un `<select>` natif : accessible au clavier, rendu par le système sur
 * mobile, et transmis par un formulaire sans JavaScript.
 */
export function LocaleSelect({
  name,
  label,
  defaultValue,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={defaultValue ?? i18nConfig.defaultLocale}
      className={cn(SELECT_CLASS, className)}
    >
      {i18nConfig.locales.map((locale) => (
        <option key={locale} value={locale}>
          {languageName(locale)}
        </option>
      ))}
    </select>
  );
}
