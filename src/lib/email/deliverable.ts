/**
 * Les adresses dont on sait d'avance qu'elles n'arriveront nulle part.
 *
 * ── Ce que ce contrôle attrape, et ce qu'il n'attrape pas ───────────────────
 *
 * Uniquement l'évident : les domaines de premier niveau réservés par la RFC
 * 2606, que personne ne peut posséder. Le jeu de démonstration s'en sert
 * exprès — et c'est ainsi qu'un reçu a été compté comme envoyé vers
 * `demo.luis@badgelane.invalid`.
 *
 * Une adresse mal orthographiée sur un vrai domaine, elle, passera ici et
 * rebondira chez le fournisseur. C'est normal : ce signal-là arrive **après**
 * l'envoi, par les webhooks de livraison, pas avant. Refuser ce qu'on sait déjà
 * faux ne prétend pas valider ce qu'on ignore.
 */
const UNDELIVERABLE_SUFFIXES = [".invalid", ".test", ".example", ".localhost"];

export function isObviouslyUndeliverable(address: string): boolean {
  const normalised = address.trim().toLowerCase();

  if (!normalised.includes("@")) return true;

  return UNDELIVERABLE_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}
