import type { EmailKind } from "@/config/email";

/**
 * L'interface d'envoi. Resend en est **une** implémentation.
 *
 * ── Pourquoi une interface, et non un appel direct ──────────────────────────
 *
 * Pas pour changer de fournisseur un jour — c'est l'argument paresseux. La
 * vraie raison est testable : la **décision** d'envoyer, le destinataire, la
 * langue et le contenu sont de la logique métier, et il faut pouvoir les
 * asserter sans réseau. Un appel direct rendrait chaque test dépendant d'un
 * service tiers, donc lent, donc désactivé, donc absent.
 *
 * Ce module est volontairement dépourvu de `server-only` : c'est un contrat de
 * types, et les scripts de vérification en fournissent leur propre
 * implémentation.
 */
export type OutboundMessage = {
  /** Adresse réellement servie — déjà redirigée hors production. */
  to: string;
  subject: string;
  /** Corps en texte simple : lisible partout, et suffisant pour ce produit. */
  body: string;
  /**
   * La clé d'idempotence, transmise **au fournisseur**.
   *
   * C'est elle qui ferme la seule fenêtre que la base ne peut pas fermer :
   * envoi réussi, processus mort avant le `commit`, ligne annulée. Au passage
   * suivant, le fournisseur reconnaît la clé et ne renvoie rien.
   */
  idempotencyKey: string;
  kind: EmailKind;
};

export type EmailAdapter = {
  send: (message: OutboundMessage) => Promise<void>;
};

/**
 * Implémentation qui n'envoie rien et l'enregistre.
 *
 * Utilisée par les vérifications : ce qu'on veut prouver — « le même paiement
 * livré deux fois ne produit qu'un e-mail » — est une propriété de notre
 * enchaînement, pas du réseau de Resend.
 */
export function recordingAdapter(): EmailAdapter & {
  sent: OutboundMessage[];
} {
  const sent: OutboundMessage[] = [];

  return {
    sent,
    send: async (message) => {
      sent.push(message);
    },
  };
}
