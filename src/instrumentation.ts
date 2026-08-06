import * as Sentry from "@sentry/nextjs";

/**
 * Point d'entrée d'instrumentation de Next.js : exécuté une fois par runtime,
 * avant tout code applicatif.
 *
 * Les configurations Sentry sont importées dynamiquement pour que le bundle
 * Node ne tire pas la variante Edge, et réciproquement.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Remonte à Sentry les erreurs levées pendant le rendu serveur, avec le contexte
 * de la requête. Inactif tant qu'aucun DSN n'est configuré.
 */
export const onRequestError = Sentry.captureRequestError;
