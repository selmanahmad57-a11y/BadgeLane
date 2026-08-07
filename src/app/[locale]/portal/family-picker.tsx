"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { SELECT_CLASS } from "@/components/locale-select";

/**
 * Sélecteur de foyer, affiché seulement quand l'adresse en rattache plusieurs.
 *
 * Le choix voyage dans l'URL plutôt que dans un cookie ou un état de session :
 * la page reste partageable, rechargeable, et surtout **le serveur revalide le
 * rattachement à chaque requête**. Un identifiant de famille écrit à la main
 * dans l'URL ne donne donc rien — il ne figure pas dans les rattachements
 * dérivés de l'adresse vérifiée, et le portail retombe sur le premier.
 */
export function FamilyPicker({
  memberships,
  activeFamilyId,
  label,
}: {
  memberships: { familyId: string; label: string }[];
  activeFamilyId: string;
  label: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      aria-label={label}
      value={activeFamilyId}
      onChange={(event) => {
        const next = new URLSearchParams(searchParams);
        next.set("family", event.target.value);
        router.push(`?${next.toString()}`);
      }}
      className={SELECT_CLASS}
    >
      {memberships.map((entry) => (
        <option key={entry.familyId} value={entry.familyId}>
          {entry.label}
        </option>
      ))}
    </select>
  );
}
