import { Resend } from "resend";

import { serverEnv } from "@/config/env.server";
import { effectiveRecipient } from "@/config/email-guard";
import { isProduction } from "@/config/runtime";

import type { EmailAdapter } from "./adapter";

/**
 * L'implémentation Resend de l'interface d'envoi.
 *
 * ── Pourquoi Resend, et pas Clerk ───────────────────────────────────────────
 *
 * Clerk envoie déjà des e-mails chez nous — c'est lui qui a vérifié l'adresse
 * du parent au Temps 1 — mais uniquement ceux de son **cycle
 * d'authentification** : code, lien magique, réinitialisation, invitation. Il
 * n'expose aucune API pour émettre un contenu arbitraire vers un destinataire
 * quelconque. « Voici les badges gagnés ce mois-ci » n'est pas un événement
 * d'authentification.
 *
 * Ce n'est donc pas une redondance mais la bonne séparation : Clerk prouve qui
 * l'on est, un routeur d'e-mails porte ce que l'application veut dire.
 *
 * ── Ce que l'interface rend réversible ──────────────────────────────────────
 *
 * Postmark ou SES prendraient cette place sans que rien d'autre bouge. Ce
 * fichier est la seule chose à réécrire.
 */

/**
 * `null` quand aucune clé n'est configurée.
 *
 * Une instance sans envoi doit fonctionner — c'est le même choix que pour
 * Stripe : l'appelant prévoit l'absence plutôt que de découvrir une panne.
 */
export function resendAdapter(): EmailAdapter | null {
  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.EMAIL_FROM;

  if (!apiKey || !from) return null;

  const client = new Resend(apiKey);

  return {
    send: async (message) => {
      /**
       * La redirection hors production est appliquée ICI, au dernier moment
       * possible.
       *
       * Le placer plus haut laisserait un appelant futur composer son propre
       * envoi en oubliant de passer par la garde. Au point de sortie, aucun
       * chemin ne la contourne.
       */
      const to = effectiveRecipient(message.to, {
        emailTestRecipient: serverEnv.EMAIL_TEST_RECIPIENT,
        isProduction,
      });

      const { error } = await client.emails.send(
        {
          from,
          to,
          subject: message.subject,
          text: message.body,
        },
        {
          /**
           * LA clé qui ferme la fenêtre que la base ne peut pas fermer : envoi
           * réussi, processus mort avant le `commit`, ligne d'idempotence
           * annulée. Au passage suivant, Resend reconnaît la clé et ne renvoie
           * rien.
           */
          idempotencyKey: message.idempotencyKey,
        },
      );

      if (error) {
        throw new Error(`Resend a refusé l'envoi : ${error.message}`);
      }
    },
  };
}
