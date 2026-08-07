import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BadgeWall } from "@/components/badge-wall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { routes } from "@/config/routes";
import {
  getPortalChildProgress,
  getPortalChildren,
} from "@/db/portal-queries";
import { Link } from "@/i18n/navigation";
import { requireParentMemberships } from "@/lib/parent-auth";

import { PortalShell } from "../../portal-shell";

type PortalStudentPageProps = {
  params: Promise<{ locale: string; studentId: string }>;
  searchParams: Promise<{ family?: string }>;
};

/**
 * Le mur de badges d'un enfant, vu par son parent.
 *
 * Réutilise `BadgeWall` de la Semaine 7 sans le dupliquer : les badges se
 * dérivent des compétences acquises, et cette dérivation ne change pas selon
 * qui regarde. Une seconde implémentation « côté parent » finirait par diverger,
 * et un même enfant serait Guppy sur un écran et pas sur l'autre.
 */
export default async function PortalStudentPage({
  params,
  searchParams,
}: PortalStudentPageProps) {
  const { locale, studentId } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("portal");
  const memberships = await requireParentMemberships(locale);

  if (memberships.length === 0) notFound();

  const requested = (await searchParams).family;
  const active =
    memberships.find((entry) => entry.familyId === requested) ?? memberships[0];

  /**
   * L'appartenance de l'élève au foyer est revérifiée ici, et la RLS la
   * revérifie derrière. L'identifiant vient de l'URL : le seul endroit d'où il
   * ne faut jamais faire confiance.
   */
  const children = await getPortalChildren(
    active.organizationId,
    active.familyId,
  );
  const child = children.find((entry) => entry.id === studentId);

  /**
   * Un enfant d'un autre foyer est indiscernable d'un enfant inexistant :
   * répondre « interdit » confirmerait son existence. Même règle que la fiche
   * élève de la console.
   */
  if (!child) notFound();

  const progress = await getPortalChildProgress(
    active.organizationId,
    active.familyId,
    studentId,
  );

  return (
    <PortalShell
      title={`${child.firstName} ${child.lastName}`}
      description={
        child.currentLevelName
          ? `${child.currentProgramName} · ${child.currentLevelName}`
          : t("noLevel")
      }
    >
      <p className="-mt-2 text-sm">
        <Link
          href={routes.portal}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToChildren")}
        </Link>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{t("badgesHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <BadgeWall levels={progress} />
        </CardContent>
      </Card>
    </PortalShell>
  );
}
