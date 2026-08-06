import { z } from "zod";

/**
 * Helpers partagés par la validation de l'environnement client et serveur.
 *
 * Règle du projet : aucune valeur métier n'est écrite en dur dans le code.
 * Tout ce qui est configurable transite par une variable d'environnement,
 * validée ici une seule fois au démarrage. Une variable absente ou invalide
 * fait échouer le boot avec un message explicite, plutôt que de laisser une
 * valeur implicite se propager silencieusement.
 */

/**
 * Une variable absente et une variable présente mais vide doivent être traitées
 * de la même façon. Sans ça, `FOO=` dans un `.env` copié depuis l'exemple
 * passerait la validation `optional()` en tant que chaîne vide, ou serait
 * coercée en `0` par `z.coerce.number()`.
 */
export function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim() === "" ? undefined : value;
}

/** Chaîne obligatoire, non vide une fois trimée. */
export const requiredString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1),
);

/** Chaîne facultative : absente, vide ou blanche => `undefined`. */
export const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1).optional(),
);

/** URL absolue obligatoire. */
export const requiredUrl = z.preprocess(emptyStringToUndefined, z.url());

/** Ratio facultatif dans [0, 1] — utilisé pour les taux d'échantillonnage. */
export const optionalRatio = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().min(0).max(1).optional(),
);

/** Entier strictement positif, facultatif. */
export const optionalPositiveInt = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional(),
);

/**
 * Liste séparée par des virgules => tableau de chaînes non vides.
 * Permet d'ajouter une langue (ou toute autre liste) sans toucher au code.
 */
export const requiredStringList = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .refine((entries) => entries.length > 0, {
      message: "doit contenir au moins une entrée",
    }),
);

/**
 * Formate une erreur de validation d'environnement en message actionnable :
 * on veut savoir *quelle* variable manque et *où* la renseigner.
 */
export function formatEnvError(
  scope: "client" | "serveur",
  error: z.ZodError,
  exampleFile: string,
): Error {
  return new Error(
    [
      `Configuration d'environnement ${scope} invalide.`,
      z.prettifyError(error),
      "",
      `Renseigne les variables manquantes dans .env.local (modèle : ${exampleFile}).`,
    ].join("\n"),
  );
}
