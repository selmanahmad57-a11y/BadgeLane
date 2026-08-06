"use client";

import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/**
 * Formulaire relié à une action serveur.
 *
 * Mutualisé pour que chaque écriture obtienne, sans réécriture, l'état en cours
 * d'envoi et l'affichage traduit de l'erreur. Le message vient d'une clé
 * renvoyée par le serveur, jamais d'un texte technique : l'utilisateur n'a pas
 * à lire nos messages d'erreur internes, et rien de la structure interne ne
 * fuite dans l'interface.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  variant,
  size,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const t = useTranslations("actionErrors");
  /**
   * Les refus métier ont leur propre message. Le repli « vérifie les champs »
   * ne concerne que les saisies malformées — répondre cela à quelqu'un qui
   * vient de cliquer « donner une place » n'aurait aucun sens : il n'y a pas
   * de champ.
   */
  const reasons = useTranslations("actionReasons");

  const [state, submit, pending] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => action(formData),
    null,
  );

  return (
    <form action={submit} className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <Button type="submit" disabled={pending} variant={variant} size={size}>
          {submitLabel}
        </Button>
      </div>

      {state && !state.ok ? (
        /**
         * `role="alert"` fait annoncer le message par les lecteurs d'écran dès
         * son apparition — sans quoi un échec resterait invisible à qui ne voit
         * pas le formulaire.
         */
        <p role="alert" className="text-destructive text-sm">
          {state.reason
            ? reasons(state.reason, state.reasonValues)
            : t(state.errorKey)}
        </p>
      ) : null}
    </form>
  );
}
