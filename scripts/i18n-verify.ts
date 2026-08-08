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

  const { problems: usageProblems, checked, dynamic } = checkUsedKeys(reference);
  problems.push(...usageProblems);
  console.log(
    `Usage : ${checked} clé(s) référencée(s) dans le code, ${dynamic} construite(s) dynamiquement (non vérifiables).`,
  );

  if (problems.length === 0) {
    console.log("Catalogues de traduction : OK.");
    /**
     * Le rappel qui ferme la boucle.
     *
     * `src/i18n/request.ts` charge les catalogues par un import DYNAMIQUE à
     * littéral de gabarit — c'est ce qui permet d'ajouter une langue en
     * déposant un fichier, sans toucher au TypeScript. Turbopack ne peut donc
     * pas l'analyser statiquement : il résout le JSON à l'exécution et le garde
     * en cache. Éditer un catalogue pendant que `next dev` tourne n'invalide
     * rien, et l'écran affiche `MISSING_MESSAGE` sur une clé pourtant présente.
     *
     * Ce script est le dernier endroit où quelqu'un regarde après avoir touché
     * une traduction : c'est donc ici que le rappel a le plus de chances d'être
     * lu, plutôt que dans un README qu'on relit une fois.
     */
    console.log(
      "\nRappel : un catalogue modifié n'est pris en compte qu'au redémarrage de « npm run dev » — l'import des messages est dynamique, donc mis en cache par Turbopack.",
    );
    return 0;
  }

  console.error("Catalogues de traduction : ÉCHEC.");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  return 1;
}

/** Fichiers de l'application susceptibles d'appeler une traduction. */
const SOURCE_ROOT = "src";

/**
 * Vérifie que chaque clé **utilisée dans le code** existe dans la référence.
 *
 * ── Ce que la parité ne peut pas voir ────────────────────────────────────────
 *
 * Comparer les catalogues entre eux prouve qu'ils disent la même chose — pas
 * qu'ils disent ce que le code demande. Une clé absente de **toutes** les
 * langues garde la parité parfaite et fait un `MISSING_MESSAGE` à l'écran.
 *
 * C'est exactement ce qui vient d'arriver : `i18n:verify` vert, portail cassé.
 * Le contrôle passait parce qu'il regardait le mauvais côté de la relation.
 *
 * ── Comment les clés sont retrouvées ─────────────────────────────────────────
 *
 * Chaque fichier déclare son espace de noms via `getTranslations("x")` ou
 * `useTranslations("x")`, puis appelle `t("clé")`. On recompose `x.clé`.
 *
 * Les clés **construites** — `t(`status_${valeur}`)` — ne sont pas résolubles
 * statiquement. Elles sont comptées et annoncées plutôt que passées sous
 * silence : un contrôle qui ignore ce qu'il ne sait pas faire donne une
 * confiance qu'il ne mérite pas.
 */
function checkUsedKeys(reference: Set<string>): {
  problems: string[];
  checked: number;
  dynamic: number;
} {
  const problems: string[] = [];
  let checked = 0;
  let dynamic = 0;

  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  for (const file of walk(SOURCE_ROOT)) {
    const source = readFileSync(file, "utf8");

    const namespaces = [
      ...source.matchAll(/(?:get|use)Translations\(\s*"([^"]+)"/g),
    ].map((match) => match[1]);

    if (namespaces.length === 0) continue;

    /** Un fichier à plusieurs espaces de noms rend l'attribution ambiguë. */
    const unique = [...new Set(namespaces)];

    dynamic += [...source.matchAll(/\bt\(`/g)].length;

    for (const call of source.matchAll(/\bt\(\s*"([^"]+)"/g)) {
      const key = call[1];
      checked += 1;

      const resolvable = unique.some((namespace) =>
        reference.has(`${namespace}.${key}`),
      );

      if (!resolvable) {
        problems.push(
          `${file.replace(/\\/g, "/")} : « ${unique.join(" | ")}.${key} » est appelée dans le code mais absente de la référence. La parité entre catalogues ne l'aurait pas vue — elle manque des deux côtés.`,
        );
      }
    }
  }

  return { problems, checked, dynamic };
}

process.exitCode = main();
