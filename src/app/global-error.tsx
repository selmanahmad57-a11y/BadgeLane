"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Dernier filet : une erreur survenue dans le layout racine lui-même, donc hors
 * de portée de `NextIntlClientProvider`.
 *
 * Aucune traduction n'est disponible ici — le catalogue est chargé par le layout
 * qui vient d'échouer. Le texte reste donc volontairement minimal et neutre.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p>Something went wrong.</p>
      </body>
    </html>
  );
}
