import { ClerkLoaded, UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";

/**
 * Cadre du portail parent.
 *
 * Volontairement distinct de `ConsoleShell` : celui-ci monte un
 * `OrganizationSwitcher`, qui n'a aucun sens pour un parent — il n'appartient à
 * aucune Organisation. Le monter afficherait au mieux un sélecteur vide, au
 * pire une invitation à créer une école.
 *
 * Mobile-first, et sans navigation pour l'instant : ce temps n'ouvre qu'un
 * écran. Les onglets viendront quand il y aura plusieurs destinations.
 */
export function PortalShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-balance">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground text-sm text-pretty">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex min-h-8 shrink-0 items-center">
          <ClerkLoaded>
            <UserButton />
          </ClerkLoaded>
        </div>
      </div>

      {children}
    </main>
  );
}
