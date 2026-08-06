import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { buildEnv, isSentryBuildUploadEnabled } from "./src/config/env.build";

const nextConfig: NextConfig = {
  turbopack: {
    /**
     * Ancre la racine du projet au dépôt. Sans ça, Turbopack remonte jusqu'au
     * premier lockfile trouvé — ici un `package-lock.json` traînant dans le
     * répertoire personnel — et bâtit un graphe de modules hors du dépôt.
     */
    root: import.meta.dirname,
  },
};

/** Branche next-intl sur `src/i18n/request.ts` (chemin par défaut du plugin). */
const withInternationalization = createNextIntlPlugin();

const configWithInternationalization = withInternationalization(nextConfig);

/**
 * Sentry n'enveloppe la configuration que si les identifiants d'upload de
 * source maps sont présents. Sans eux, `withSentryConfig` ferait échouer le
 * build — or un build doit rester possible sans compte Sentry.
 */
export default isSentryBuildUploadEnabled
  ? withSentryConfig(configWithInternationalization, {
      org: buildEnv.SENTRY_ORG,
      project: buildEnv.SENTRY_PROJECT,
      authToken: buildEnv.SENTRY_AUTH_TOKEN,
      silent: true,
    })
  : configWithInternationalization;
