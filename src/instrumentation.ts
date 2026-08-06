import type * as SentryTypes from "@sentry/nextjs";

import { isServerSentryEnabled } from "@/config/env.observability";

/**
 * Point d'entrée d'instrumentation de Next.js : exécuté une fois par runtime,
 * avant tout code applicatif.
 *
 * Sans DSN configuré, le SDK Sentry n'est pas chargé du tout — pas seulement
 * désactivé. Importer inconditionnellement une dépendance de cette taille
 * alourdirait chaque démarrage à froid, y compris en développement où Sentry
 * n'est presque jamais branché.
 *
 * Les imports sont dynamiques pour une seconde raison : le bundle Node ne doit
 * pas tirer la variante Edge, ni l'inverse.
 */
export async function register() {
  if (!isServerSentryEnabled) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Remonte à Sentry les erreurs levées pendant le rendu serveur, avec le contexte
 * de la requête.
 *
 * Next.js appelle ce hook à chaque erreur : la référence au SDK est donc
 * résolue paresseusement, pour que l'absence de DSN n'entraîne aucun coût.
 */
export const onRequestError: typeof SentryTypes.captureRequestError = async (
  ...args
) => {
  if (!isServerSentryEnabled) return;

  const Sentry = await import("@sentry/nextjs");
  return Sentry.captureRequestError(...args);
};
