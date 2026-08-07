import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import type { Locale } from "@/config/i18n";
import { localizedPath, routes } from "@/config/routes";
import { db } from "@/db/client";
import { verifiedEmailsOf } from "./verified-email";

/**
 * Authentification du parent, et découpe de son accès.
 *
 * ── Le parent n'est pas membre de l'école ────────────────────────────────────
 *
 * C'est la décision structurante. Un membre d'Organisation Clerk porte un
 * `orgId` dans sa session, et tout le code des Semaines 1 à 9 fait
 * `withTenant(orgId)` — il verrait donc l'école entière. La sécurité reposerait
 * alors sur le fait que *chaque* requête pense à filtrer par famille. Un oubli,
 * une fuite.
 *
 * Le parent est donc un utilisateur Clerk **sans aucune appartenance**. Il ne
 * peut pas obtenir de contexte d'organisation, quoi qu'il tente.
 *
 * ── Le lien est dérivé, jamais stocké ────────────────────────────────────────
 *
 * Aucun `clerk_user_id` sur `guardian`. Le rattachement se recalcule à chaque
 * requête depuis l'adresse e-mail. Ce n'est pas seulement de la doctrine : si
 * l'école corrige une faute de frappe dans `guardian.email`, un identifiant
 * stocké laisserait l'ancien titulaire connecté — le lien survivrait à la
 * donnée qui le justifiait. En dérivant, l'accès suit toujours l'enregistrement
 * courant.
 *
 * ── LA ligne qui sépare ce design d'une faille ───────────────────────────────
 *
 * Seules les adresses dont Clerk atteste la **vérification** sont retenues.
 * `user.emailAddresses` contient aussi celles qu'un compte a simplement
 * déclarées : s'en servir laisserait n'importe qui saisir l'adresse d'un parent
 * et récupérer le portail de ses enfants. Le filtre ci-dessous est la seule
 * chose qui l'empêche, et `parent-authz:verify` le prouve par un contrôle
 * négatif dédié.
 */

/**
 * Le sujet d'une requête. Union discriminée, à dessein.
 *
 * Un parent n'est pas un membre du personnel moins doté : il ne figure dans
 * aucune matrice de rôles et `can()` ne l'accepte pas. Les deux types ne se
 * rencontrent jamais, donc aucun contrôle ne peut accorder par accident une
 * capacité de personnel à un parent.
 */
export type ParentPrincipal = {
  kind: "parent";
  organizationId: string;
  familyId: string;
  guardianId: string;
  guardianName: string;
  preferredLanguage: string;
};

/**
 * Une famille rattachée à l'adresse du visiteur.
 *
 * Trois identifiants, et rien d'autre. Le nom du foyer, celui du tuteur et sa
 * langue se lisent normalement une fois le contexte posé par `withFamily()` :
 * les faire sortir de l'amorçage reviendrait à élargir une exception au lieu de
 * la contenir.
 */
export type ParentMembership = {
  organizationId: string;
  familyId: string;
  guardianId: string;
};

/**
 * Toutes les familles rattachées à ces adresses, toutes écoles confondues.
 *
 * Une même adresse peut rattacher plusieurs familles : deux écoles, ou deux
 * foyers. On les renvoie **toutes** et le portail fait choisir. Prendre la
 * première serait un choix arbitraire et invisible.
 *
 * Cette lecture est le seul point du portail à s'exécuter hors contexte de
 * tenant — comme la résolution du compte Stripe dans le webhook, c'est un
 * amorçage : on ne peut pas poser un contexte qu'on cherche justement à
 * établir. Elle ne lit que ce qu'il faut pour l'établir, et rien d'autre.
 */
export async function findMembershipsForEmails(
  emails: readonly string[],
): Promise<ParentMembership[]> {
  if (emails.length === 0) return [];

  /**
   * Passage obligé par la fonction `resolve_guardian_families`, et non par une
   * requête ordinaire sur `guardian`.
   *
   * Une requête ordinaire renverrait **zéro ligne** : depuis la Semaine 10,
   * `guardian` est soumise à la RLS, qui exige un contexte d'école — celui-là
   * même qu'on cherche ici à établir. C'est l'amorçage circulaire de la
   * Semaine 1, et il se résout comme au webhook Stripe : par un point d'entrée
   * unique, minimal, et dont l'exception est écrite noir sur blanc.
   *
   * La fonction n'accepte que des adresses déjà connues et ne rend que des
   * identifiants : elle ne peut donc pas servir à énumérer les familles d'une
   * école, ni à récupérer une adresse qu'on n'avait pas.
   */
  const { rows } = await db.execute(
    sql`select organization_id, family_id, guardian_id
        from resolve_guardian_families(${sql.param(emails as string[])}::text[])`,
  );

  return (
    rows as unknown as {
      organization_id: string;
      family_id: string;
      guardian_id: string;
    }[]
  ).map((row) => ({
    organizationId: row.organization_id,
    familyId: row.family_id,
    guardianId: row.guardian_id,
  }));
}

/**
 * Exige un visiteur connecté, rattaché à au moins une famille.
 *
 * Redirige plutôt que de lever : appelée depuis un composant serveur, elle doit
 * amener le visiteur à l'étape qui lui manque.
 */
export async function requireParentMemberships(
  locale: Locale,
): Promise<ParentMembership[]> {
  const { userId } = await auth();

  if (!userId) {
    redirect(localizedPath(locale, routes.signIn));
  }

  const user = await currentUser();

  if (!user) {
    redirect(localizedPath(locale, routes.signIn));
  }

  const emails = verifiedEmailsOf(user);

  return findMembershipsForEmails(emails);
}
