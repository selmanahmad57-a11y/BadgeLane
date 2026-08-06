/**
 * Mode d'exécution, fourni par l'outillage Next.js (`NODE_ENV`).
 * Centralisé ici pour qu'aucun module ne teste la chaîne directement.
 */
export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = process.env.NODE_ENV === "development";
export const isTest = process.env.NODE_ENV === "test";
