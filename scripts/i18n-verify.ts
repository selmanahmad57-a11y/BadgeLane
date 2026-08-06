import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Vérifie que tous les catalogues de traduction exposent exactement les mêmes
 * clés.
 *
 * Une clé absente d'une langue ne provoque ni erreur de compilation ni erreur
 * de lint : elle se voit uniquement à l'écran, dans la langue concernée, chez
 * l'utilisateur. C'est précisément le genre de défaut qu'un lancement bilingue
 * (§2 du blueprint) ne peut pas se permettre.
 *
 * La langue de référence est celle de `NEXT_PUBLIC_DEFAULT_LOCALE` si elle est
 * définie, sinon le premier fichier par ordre alphabétique.
 */

const MESSAGES_DIRECTORY = "messages";

type Catalog = Record<string, unknown>;

/** Aplatit `{a:{b:1}}` en `["a.b"]`, pour comparer des chemins et non des objets. */
function collectKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Catalog).flatMap(([key, nested]) =>
    collectKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

function main(): number {
  const files = readdirSync(MESSAGES_DIRECTORY)
    .filter((name) => name.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.error(`Aucun catalogue trouvé dans ${MESSAGES_DIRECTORY}/.`);
    return 1;
  }

  const catalogs = new Map<string, Set<string>>();

  for (const file of files) {
    const locale = file.replace(/\.json$/, "");
    const raw = readFileSync(join(MESSAGES_DIRECTORY, file), "utf8");

    try {
      catalogs.set(locale, new Set(collectKeys(JSON.parse(raw))));
    } catch (error) {
      console.error(
        `${file} : JSON invalide — ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }

  const defaultLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  const referenceLocale =
    defaultLocale && catalogs.has(defaultLocale)
      ? defaultLocale
      : [...catalogs.keys()][0];

  const reference = catalogs.get(referenceLocale)!;
  const problems: string[] = [];

  for (const [locale, keys] of catalogs) {
    if (locale === referenceLocale) continue;

    const missing = [...reference].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !reference.has(key));

    for (const key of missing) {
      problems.push(`${locale} : clé manquante « ${key} »`);
    }
    for (const key of extra) {
      problems.push(
        `${locale} : clé « ${key} » absente de la référence (${referenceLocale})`,
      );
    }
  }

  console.log(
    `Référence : ${referenceLocale} (${reference.size} clés) — comparée à ${[...catalogs.keys()].filter((l) => l !== referenceLocale).join(", ") || "aucune autre langue"}`,
  );

  if (problems.length === 0) {
    console.log("Catalogues de traduction : OK.");
    return 0;
  }

  console.error("Catalogues de traduction : ÉCHEC.");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  return 1;
}

process.exitCode = main();
