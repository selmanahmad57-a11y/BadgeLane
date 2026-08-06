import { ClerkLoaded, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { ConsoleNav } from "./console-nav";

/**
 * Cadre commun aux écrans d'administration : navigation, sélecteur d'école,
 * menu du compte, puis le contenu de la page.
 *
 * Factorisé pour que l'ajout d'un écran n'oblige pas à recopier l'en-tête — et
 * pour que la navigation reste identique d'une page à l'autre.
 */
export function ConsoleShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <h1 className="font-heading text-2xl font-semibold">{title}</h1>
            {description ? (
              <p className="text-muted-foreground text-sm text-pretty">
                {description}
              </p>
            ) : null}
          </div>
          <ConsoleNav />
        </div>

        {/*
          Ces composants lisent la session côté navigateur : montés avant que le
          SDK client ait fini de se charger, ils avertiraient qu'aucune session
          n'est active. La hauteur minimale évite que l'en-tête ne sursaute
          quand ils apparaissent.
        */}
        <div className="flex min-h-8 items-center gap-3">
          <ClerkLoaded>
            <OrganizationSwitcher hidePersonal />
            <UserButton />
          </ClerkLoaded>
        </div>
      </div>

      {children}
    </main>
  );
}
