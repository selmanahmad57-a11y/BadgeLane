import type Stripe from "stripe";

import {
  CUSTOMER_PORTAL_FEATURES,
  PARENT_PORTAL_CONFIGURATION_MARK,
  PARENT_PORTAL_FEATURES,
} from "@/config/billing";

import type { forConnectedAccount } from "./stripe";

/**
 * Le portail client de Stripe, sur le compte de l'école.
 *
 * ── Pourquoi ce module n'est PAS `server-only` ──────────────────────────────
 *
 * Il ne lit aucune base, ne détient aucun secret, et reçoit son client Stripe
 * en argument : c'est de la logique de configuration, pas un accès privilégié.
 *
 * Surtout, ce qu'il décide — un parent peut-il résilier ? — est une propriété
 * de sécurité, et une propriété de sécurité doit pouvoir être **exécutée par un
 * script**. Enfermé derrière `server-only`, il ne serait vérifiable que par
 * relecture, c'est-à-dire pas vérifiable. Même raison que `verified-email.ts`.
 *
 * ── Ce qu'il remplace ────────────────────────────────────────────────────────
 *
 * Rien à construire : Stripe sert déjà une page où le parent remplace sa carte
 * et consulte ses factures. Écrire la nôtre voudrait dire toucher aux moyens de
 * paiement, donc entrer dans le périmètre PCI que tout le modèle Connect
 * Standard sert justement à éviter (§6 du blueprint).
 *
 * ── À qui appartiennent les réglages ─────────────────────────────────────────
 *
 * L'école est le marchand : c'est **sa** configuration de portail qui doit
 * s'appliquer, y compris si elle l'a réglée elle-même dans son tableau de bord
 * Stripe. On ne l'écrase donc jamais.
 *
 * On n'en crée une que si le compte n'en a aucune — sans quoi l'ouverture du
 * portail échouerait avec « no configuration provided ». Nos réglages ne sont
 * alors qu'un point de départ raisonnable, que l'école reste libre de changer.
 */
export async function resolvePortalConfiguration(
  stripe: Stripe,
  scoped: ReturnType<typeof forConnectedAccount>,
): Promise<string | undefined> {
  const existing = await stripe.billingPortal.configurations.list(
    { active: true, limit: 1 },
    scoped,
  );

  /**
   * Le compte a déjà une configuration : on ne passe rien et Stripe applique
   * celle que l'école a désignée par défaut.
   */
  if (existing.data.length > 0) return undefined;

  const created = await stripe.billingPortal.configurations.create(
    { features: CUSTOMER_PORTAL_FEATURES },
    scoped,
  );

  return created.id;
}

/**
 * La configuration du portail **parent**, garantie présente et conforme.
 *
 * ── Le piège qu'elle ferme : « marche sur la démo, casse pour l'école n°2 » ──
 *
 * Les configurations de portail sont **par compte connecté**. Une configuration
 * posée à la main sur le compte de test n'existe chez aucune autre école. Si
 * l'absence retombait sur `undefined`, Stripe appliquerait la configuration par
 * défaut de l'école — annulation d'abonnement comprise — et le trou refermé en
 * Temps 2a se rouvrirait, **en silence, pour tous les tenants sauf celui qu'on
 * a essayé**.
 *
 * D'où l'échec fermé : cette fonction rend toujours un identifiant, ou elle
 * lève. Elle ne rend jamais « débrouille-toi ».
 *
 * ── Ensure, et non find-or-create ───────────────────────────────────────────
 *
 * Trouvée, la configuration est **remise à l'état voulu** plutôt que reprise
 * telle quelle. Le coût est nul et ça ferme un bord réel : une école qui
 * rallumerait l'annulation sur notre configuration depuis son tableau de bord
 * la verrait rétablie au prochain passage. C'est notre porte, marquée comme
 * telle ; la sienne reste intacte.
 *
 * ── La course est inoffensive ───────────────────────────────────────────────
 *
 * Deux parents de la même école, aucune configuration encore : au pire deux
 * sont créées. Toutes deux ont l'annulation désactivée — la propriété de
 * sécurité tient quoi qu'il arrive. La lecture prend la première marquée, ce
 * qui évite la dérive sans avoir à verrouiller quoi que ce soit.
 */
export async function resolveParentPortalConfiguration(
  stripe: Stripe,
  scoped: ReturnType<typeof forConnectedAccount>,
): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list(
    { limit: 100 },
    scoped,
  );

  const ours = existing.data.find(
    (configuration) =>
      configuration.metadata?.[PARENT_PORTAL_CONFIGURATION_MARK] === "true",
  );

  if (ours) {
    const repaired = await stripe.billingPortal.configurations.update(
      ours.id,
      { active: true, features: PARENT_PORTAL_FEATURES },
      scoped,
    );

    return repaired.id;
  }

  const created = await stripe.billingPortal.configurations.create(
    {
      features: PARENT_PORTAL_FEATURES,
      metadata: { [PARENT_PORTAL_CONFIGURATION_MARK]: "true" },
    },
    scoped,
  );

  return created.id;
}
