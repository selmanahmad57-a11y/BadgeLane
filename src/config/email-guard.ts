/**
 * La règle qui empêche d'écrire aux vraies familles depuis un poste de travail.
 *
 * ── Pourquoi ce module est pur, et sans `server-only` ───────────────────────
 *
 * Un e-mail envoyé ne se rappelle pas. C'est le seul effet de bord du produit
 * qu'aucune transaction ne peut annuler — donc la règle qui le borne est une
 * propriété de sécurité, et une propriété de sécurité doit pouvoir être
 * **exécutée par un script**. Enfermée derrière `server-only`, elle ne serait
 * vérifiable que par relecture, c'est-à-dire pas vérifiable.
 *
 * Même raison que `verified-email.ts`, `stripe-portal.ts` et `makeup.ts`.
 */

export type EmailConfiguration = {
  resendApiKey: string | undefined;
  emailFrom: string | undefined;
  emailTestRecipient: string | undefined;
  isProduction: boolean;
};

export type EmailConfigurationProblem = {
  field: "EMAIL_TEST_RECIPIENT" | "EMAIL_FROM";
  message: string;
};

/**
 * Les raisons de **refuser le démarrage**.
 *
 * Pas un avertissement dans un journal que personne ne lit : un refus, au
 * moment où c'est encore rattrapable. L'oubli doit être impossible, pas
 * seulement improbable.
 */
export function emailConfigurationProblems(
  configuration: EmailConfiguration,
): EmailConfigurationProblem[] {
  const problems: EmailConfigurationProblem[] = [];

  /** Sans clé d'envoi, rien ne peut partir : il n'y a rien à border. */
  if (!configuration.resendApiKey) return problems;

  if (!configuration.isProduction && !configuration.emailTestRecipient) {
    problems.push({
      field: "EMAIL_TEST_RECIPIENT",
      message:
        "RESEND_API_KEY est renseignée hors production sans EMAIL_TEST_RECIPIENT. Tout envoi partirait aux vraies adresses des familles. Renseigne une adresse de test — elle recevra la totalité des e-mails.",
    });
  }

  if (!configuration.emailFrom) {
    problems.push({
      field: "EMAIL_FROM",
      message:
        "RESEND_API_KEY est renseignée sans EMAIL_FROM : aucun expéditeur à présenter. En bac à sable Resend, « onboarding@resend.dev » convient.",
    });
  }

  return problems;
}

/**
 * Le destinataire réel d'un envoi.
 *
 * Hors production, la redirection est **totale** : le destinataire calculé est
 * ignoré. Ce n'est pas une commodité de mise au point, c'est la seule chose qui
 * garantit qu'aucune famille de démonstration ne reçoit de courrier.
 */
export function effectiveRecipient(
  intended: string,
  configuration: Pick<EmailConfiguration, "emailTestRecipient" | "isProduction">,
): string {
  if (configuration.isProduction) return intended;

  return configuration.emailTestRecipient ?? intended;
}
