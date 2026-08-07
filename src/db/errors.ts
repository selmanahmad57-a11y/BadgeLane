import {
  ERROR_CAUSE_MAX_DEPTH,
  UNIQUE_VIOLATION_SQLSTATE,
} from "@/config/database";

/**
 * Reconnaissance des erreurs Postgres à travers les emballages successifs.
 *
 * Le pilote lève une erreur qui porte le SQLSTATE. Drizzle l'attrape et la
 * ré-emballe dans une `DrizzleQueryError` — laquelle porte la requête et les
 * paramètres, mais **pas** le code : celui-ci n'est plus qu'au bout de la
 * chaîne `cause`.
 *
 * Lire `error.code` directement rend donc le test toujours faux, en silence.
 * C'est exactement ce qui s'est produit : le rejeu d'un événement Stripe
 * répondait 500 au lieu de 200, la contrainte tenant bon mais le doublon
 * n'étant pas reconnu comme tel. Stripe aurait retenté indéfiniment, puis
 * désactivé l'endpoint. Aucune relecture du code ne l'aurait montré — il a
 * fallu rejouer un vrai événement pour le voir.
 *
 * La chaîne est donc parcourue jusqu'au bout, et non déballée d'un cran : la
 * profondeur d'emballage est un détail de version, pas un invariant.
 */
function hasSqlState(error: unknown, sqlState: string): boolean {
  let current = error;

  for (let depth = 0; depth < ERROR_CAUSE_MAX_DEPTH; depth += 1) {
    if (current === null || typeof current !== "object") return false;
    if ((current as { code?: unknown }).code === sqlState) return true;

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * L'écriture a heurté une contrainte d'unicité.
 *
 * Pour le webhook, ce n'est pas une panne : c'est la preuve que l'événement a
 * déjà été traité intégralement, transaction comprise.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasSqlState(error, UNIQUE_VIOLATION_SQLSTATE);
}
