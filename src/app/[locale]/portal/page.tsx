import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portalStudentPath } from "@/config/routes";
import { getPortalChildren, getPortalSchool } from "@/db/portal-queries";
import { Link } from "@/i18n/navigation";
import { requireParentMemberships } from "@/lib/parent-auth";

import { PortalShell } from "./portal-shell";
import { FamilyPicker } from "./family-picker";

type PortalPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ family?: string }>;
};

/**
 * « Mes enfants » — la première page qu'un parent voit.
 *
 * C'est aussi la première fois depuis la Semaine 7 que les badges atteignent
 * quelqu'un d'autre que le personnel. Le coach coche « flotte 5 s » au bord du
 * bassin ; le parent le voit ici. Toute la chaîne existe enfin.
 *
 * En lecture seule : ce temps ouvre une porte d'accès, il n'ajoute aucune
 * écriture. Mélanger les deux rendrait indécidable l'origine d'un incident.
 */
export default async function PortalPage({
  params,
  searchParams,
}: PortalPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("portal");
  const memberships = await requireParentMemberships(locale);

  /**
   * Aucune famille rattachée : un refus qui dit quoi faire, pas un portail
   * vide. C'est le cas d'un compte dont l'adresse n'est sur aucune fiche —
   * ou dont l'adresse n'est pas encore vérifiée.
   */
  if (memberships.length === 0) {
    return (
      <PortalShell title={t("heading")}>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("noFamilyHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("noFamilyBody")}
          </CardContent>
        </Card>
      </PortalShell>
    );
  }

  /**
   * Une même adresse peut rattacher plusieurs foyers — deux écoles, ou deux
   * familles. On ne choisit pas à sa place : prendre la première serait un
   * choix arbitraire et invisible.
   */
  const requested = (await searchParams).family;
  const active =
    memberships.find((entry) => entry.familyId === requested) ?? memberships[0];

  const [school, children] = await Promise.all([
    getPortalSchool(active.organizationId, active.familyId),
    getPortalChildren(active.organizationId, active.familyId),
  ]);

  return (
    <PortalShell
      title={t("heading")}
      description={school ? t("atSchool", { school: school.name }) : undefined}
    >
      {memberships.length > 1 ? (
        <FamilyPicker
          memberships={memberships.map((entry) => ({
            familyId: entry.familyId,
            label: entry.familyLabel,
          }))}
          activeFamilyId={active.familyId}
          label={t("chooseFamily")}
        />
      ) : null}

      {children.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("noChildrenHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("noChildrenBody")}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                href={portalStudentPath(child.id)}
                className="bg-card ring-foreground/10 hover:ring-foreground/25 flex items-center justify-between gap-3 rounded-xl p-4 ring-1 transition-colors"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {child.firstName} {child.lastName}
                  </span>
                  <span className="text-muted-foreground mt-0.5 flex items-center gap-2 text-sm">
                    {child.currentLevelColor ? (
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: child.currentLevelColor }}
                      />
                    ) : null}
                    {child.currentLevelName
                      ? `${child.currentProgramName} · ${child.currentLevelName}`
                      : t("noLevel")}
                  </span>
                </span>
                <span aria-hidden className="text-muted-foreground shrink-0">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
