import { clientEnv } from "./env.client";

/**
 * Configuration linguistique de l'application.
 *
 * Les langues ne sont pas figées dans le code : elles proviennent de
 * `NEXT_PUBLIC_SUPPORTED_LOCALES`. Activer une langue supplémentaire = ajouter
 * son code à cette variable et déposer le fichier `messages/<code>.json`
 * correspondant. Aucun fichier TypeScript n'est à modifier.
 */
export const i18nConfig = {
  locales: clientEnv.NEXT_PUBLIC_SUPPORTED_LOCALES,
  defaultLocale: clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE,
} as const;

/**
 * Le type reste `string` — et non une union littérale — parce que la liste des
 * langues est résolue à l'exécution. C'est le prix de l'ajout d'une langue sans
 * toucher au code ; `isSupportedLocale` fait le rétrécissement au bon endroit.
 */
export type Locale = string;

export function isSupportedLocale(value: string | undefined): value is Locale {
  return value !== undefined && i18nConfig.locales.includes(value);
}

/**
 * Extrait la langue du premier segment d'une URL, ou `undefined` si ce segment
 * n'est pas une langue active. Utilisé pour rediriger sans perdre la langue
 * choisie par le visiteur.
 */
export function localeFromPathname(pathname: string): Locale | undefined {
  const [firstSegment] = pathname.split("/").filter(Boolean);
  return isSupportedLocale(firstSegment) ? firstSegment : undefined;
}

/**
 * Nom d'une langue, écrit dans cette langue même : `en` -> « English »,
 * `es` -> « Español », `ar` -> « العربية ».
 *
 * Les noms proviennent des données CLDR embarquées dans le moteur JavaScript,
 * jamais d'une table tenue à la main : activer une langue supplémentaire
 * n'oblige donc à traduire son nom dans aucun fichier.
 *
 * L'affichage se fait dans la langue concernée, et non dans celle de la page :
 * quelqu'un qui ne lit pas l'anglais doit pouvoir reconnaître la sienne.
 */
export function languageName(locale: Locale): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
    );
  } catch {
    return locale;
  }
}

export type TextDirection = "ltr" | "rtl";

/**
 * Sens d'écriture d'une langue, déduit des données CLDR embarquées dans le
 * moteur JavaScript plutôt que d'une liste tenue à la main.
 *
 * C'est ce qui rend l'ajout d'une langue RTL (arabe, hébreu — §2 du blueprint)
 * transparent : la direction est correcte sans toucher au code.
 */
/**
 * `getTextInfo()` fait partie d'ECMA-402 mais n'est pas encore décrit par les
 * types TypeScript embarqués ; certains moteurs exposent encore l'ancienne
 * propriété `textInfo`. Les deux formes sont donc traitées, avec repli LTR.
 */
type LocaleWithTextInfo = Intl.Locale & {
  getTextInfo?: () => { direction?: string };
  textInfo?: { direction?: string };
};

export function textDirection(locale: Locale): TextDirection {
  try {
    const resolved = new Intl.Locale(locale) as LocaleWithTextInfo;
    const direction =
      resolved.getTextInfo?.().direction ?? resolved.textInfo?.direction;

    return direction === "rtl" ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}
