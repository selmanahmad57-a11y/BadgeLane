import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import { INVITABLE_STAFF_ROLES, STAFF_ROLES } from "@/config/roles";
import { FIELD_LIMITS } from "@/config/validation";
import { getStaffMembers } from "@/db/queries";
import { requireOrganizationSession } from "@/lib/auth";

import {
  changeStaffRole,
  inviteStaffMember,
  setStaffMemberActive,
} from "./actions";

type StaffPageProps = {
  params: Promise<{ locale: string }>;
};

/** Styles d'un `<select>` natif, alignés sur ceux du composant Input. */
const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

/**
 * Gestion du personnel (§4-A du blueprint).
 *
 * Deux systèmes se partagent le sujet : Clerk gère les comptes et envoie les
 * invitations, BadgeLane détient les rôles métier. Le rôle affiché ici est
 * celui de la base — le seul que consultent les contrôles d'autorisation.
 */
export default async function StaffPage({ params }: StaffPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("staff");
  const roleLabels = await getTranslations("roles");

  const members = await getStaffMembers(session.organization.id);
  const canManage = can(session.staffUser.role, "staff:manage");

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("inviteHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActionForm action={inviteStaffMember} submitLabel={t("invite")}>
              <Input
                type="email"
                name="email"
                required
                maxLength={FIELD_LIMITS.email}
                placeholder={t("emailPlaceholder")}
                aria-label={t("email")}
                className="w-full sm:w-72"
              />
              <select
                name="role"
                aria-label={t("role")}
                defaultValue={INVITABLE_STAFF_ROLES[1]}
                className={SELECT_CLASS}
              >
                {INVITABLE_STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels(role)}
                  </option>
                ))}
              </select>
            </ActionForm>

            <p className="text-muted-foreground text-sm text-pretty">
              {t("inviteHint")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {members.map((member) => {
          const isSelf = member.id === session.staffUser.id;

          return (
            <li key={member.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">
                      {member.fullName ?? member.email}
                      {isSelf ? (
                        <span className="text-muted-foreground ms-2 text-sm font-normal">
                          {t("you")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground truncate text-sm">
                      {member.email}
                    </p>
                    {!member.active ? (
                      <p className="text-destructive text-sm">
                        {t("deactivated")}
                      </p>
                    ) : null}
                  </div>

                  {/*
                    Un membre ne peut pas modifier son propre accès : c'est le
                    moyen le plus simple de se verrouiller dehors. L'action
                    serveur applique la même règle — ceci n'en est que le reflet.
                  */}
                  {canManage && !isSelf ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionForm
                        action={changeStaffRole}
                        submitLabel={t("saveRole")}
                        size="sm"
                      >
                        <input
                          type="hidden"
                          name="staffUserId"
                          value={member.id}
                        />
                        <select
                          name="role"
                          aria-label={t("role")}
                          defaultValue={member.role}
                          className={SELECT_CLASS}
                        >
                          {STAFF_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {roleLabels(role)}
                            </option>
                          ))}
                        </select>
                      </ActionForm>

                      <ActionForm
                        action={setStaffMemberActive}
                        submitLabel={
                          member.active ? t("deactivate") : t("reactivate")
                        }
                        variant={member.active ? "destructive" : "outline"}
                        size="sm"
                      >
                        <input
                          type="hidden"
                          name="staffUserId"
                          value={member.id}
                        />
                        <input
                          type="hidden"
                          name="active"
                          value={member.active ? "false" : "true"}
                        />
                      </ActionForm>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      {roleLabels(member.role)}
                    </span>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </ConsoleShell>
  );
}
