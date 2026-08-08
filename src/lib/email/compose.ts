import { createTranslator } from "next-intl";

import type { Locale } from "@/config/i18n";

/**
 * Composition des e-mails, dans la langue de la famille.
 *
 * ── Le piège que ce module ferme ────────────────────────────────────────────
 *
 * Un e-mail se compose côté serveur, loin de l'i18n de l'écran. C'est la seule
 * surface de texte du produit qui peut échapper à la discipline que suit chaque
 * chaîne de l'interface — et le premier reçu que j'ai envoyé était en français,
 * une langue que BadgeLane ne sert même pas.
 *
 * Le contenu passe donc par le **même catalogue** que l'écran : `messages/*.json`,
 * clés en `en` et `es`, et `i18n:verify` casse si l'une manque. Un parent
 * anglophone ne peut plus recevoir un reçu dans une autre langue.
 *
 * ── Pourquoi `createTranslator` et non `getTranslations` ────────────────────
 *
 * `getTranslations` exige un contexte de requête ; un webhook n'en a pas, et un
 * script de vérification non plus. `createTranslator` prend le catalogue en
 * argument — donc la composition est **pure et testable**, ce qui est tout
 * l'intérêt d'avoir sorti l'envoi derrière un adaptateur.
 */

export type ComposedEmail = { subject: string; body: string };

async function catalogFor(locale: Locale): Promise<Record<string, unknown>> {
  /** Même import dynamique que `src/i18n/request.ts` : une seule source. */
  return (await import(`../../../messages/${locale}.json`)).default;
}

export async function composePaymentConfirmation(
  locale: Locale,
  values: { guardian: string; school: string; amount: string },
): Promise<ComposedEmail> {
  /**
   * Le cast est nécessaire : next-intl infère ses clés d'un type global bâti
   * pour les composants, et ce catalogue-ci est chargé dynamiquement. Le
   * contrôle qui compte n'est pas celui du compilateur mais `i18n:verify`, qui
   * vérifie l'existence réelle de la clé dans les deux langues.
   */
  const t = createTranslator({
    locale,
    messages: await catalogFor(locale),
    namespace: "email",
  }) as unknown as (key: string, values?: Record<string, string>) => string;

  return {
    subject: t("paymentConfirmationSubject", values),
    body: t("paymentConfirmationBody", values),
  };
}

/**
 * Le rapport de progression mensuel — l'autre surface de composition.
 *
 * Écrite ici, et non dans son propre module, pour une raison de couverture :
 * le balayage de `i18n:verify` rattache les clés à l'espace de noms déclaré
 * dans le **fichier**. Une seconde composition ailleurs devrait redéclarer le
 * sien — et si elle l'oubliait, le contrôle échouerait désormais au lieu de
 * l'ignorer.
 */
export async function composeMonthlyProgress(
  locale: Locale,
  values: {
    guardian: string;
    child: string;
    school: string;
    achievements: string;
  },
): Promise<ComposedEmail> {
  const t = createTranslator({
    locale,
    messages: await catalogFor(locale),
    namespace: "email",
  }) as unknown as (key: string, values?: Record<string, string>) => string;

  return {
    subject: t("monthlyProgressSubject", values),
    body: t("monthlyProgressBody", values),
  };
}
