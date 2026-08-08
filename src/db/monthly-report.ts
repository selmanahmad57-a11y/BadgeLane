import "server-only";

import { sql } from "drizzle-orm";

import { db } from "./client";
import { withFamily } from "./tenant";

/**
 * Le rapport de progression mensuel, famille par famille.
 *
 * ── L'appariement est rendu IMPOSSIBLE, pas surveillé ───────────────────────
 *
 * Ce travail parcourt toutes les familles d'une école — donc en contexte
 * système, hors de tout foyer. C'est exactement là qu'une fuite naîtrait : une
 * jointure oubliée, et le rapport d'une famille contiendrait l'enfant d'une
 * autre.
 *
 * La parade n'est pas une garde de plus. Chaque rapport est composé **sous
 * `withFamily()`** : la barrière du Temps 1 s'applique donc à l'intérieur de la
 * boucle, et une erreur de jointure rend zéro ligne au lieu de fuiter. On ne
 * surveille pas la frontière — on la réutilise.
 *
 * ── La fenêtre du mois est celle de l'ÉCOLE ─────────────────────────────────
 *
 * `at time zone` ramène l'horodatage au calendrier local avant d'en lire le
 * mois. Un badge acquis à 23 h le 31 août à Los Angeles appartient à août ; le
 * même instant à New York appartient à septembre. Comparer des instants UTC
 * mésattribuerait les bords — même discipline que la génération des séances.
 *
 * La période est **passée en paramètre**, jamais dérivée de l'horloge : c'est
 * ce qui rend un rejeu possible et supprime le bord des mois de longueurs
 * différentes.
 *
 * ── Le héros du rapport est le BADGE ────────────────────────────────────────
 *
 * Pas une liste de compétences cochées : le **niveau franchi**. C'est lui que
 * le parent montre aux grands-parents, et il se dérive comme en Semaine 7 —
 * toutes les compétences du niveau acquises. Le mois d'attribution est celui de
 * la dernière compétence qui l'a complété.
 */

export type MonthlyReport = {
  familyId: string;
  recipient: string | null;
  guardianName: string;
  preferredLanguage: string;
  schoolName: string;
  children: {
    firstName: string;
    /** Niveaux complétés pendant la période — le cœur du message. */
    badges: { name: string; color: string }[];
    /** Compétences acquises dans le mois, badge ou non. */
    skillsAchieved: number;
  }[];
};

export async function getMonthlyReports(
  organizationId: string,
  period: string,
): Promise<MonthlyReport[]> {
  /**
   * Les familles sont listées en contexte d'école — c'est la seule lecture
   * système, et elle ne rapporte que des identifiants et le contact.
   */
  const { rows: families } = await db.execute(
    sql`select f."id", f."email", f."primary_guardian_name", f."preferred_language",
               o."name" as school_name, o."timezone"
          from "family" f
          join "organization" o on o."id" = f."organization_id"
         where f."organization_id" = ${organizationId}
         order by f."primary_guardian_name"`,
  );

  const reports: MonthlyReport[] = [];

  for (const row of families as unknown as {
    id: string;
    email: string | null;
    primary_guardian_name: string;
    preferred_language: string;
    school_name: string;
    timezone: string;
  }[]) {
    /** ── La barrière du Temps 1, à l'intérieur de la boucle ──────────────── */
    const children = await withFamily(organizationId, row.id, async (tx) => {
      const { rows } = await tx.execute(
        sql`
          with achieved as (
            select sp."student_id", sk."level_id", sp."skill_id", sp."achieved_at"
              from "skill_progress" sp
              join "skill" sk on sk."id" = sp."skill_id"
             where sp."status" = 'achieved'
          ),
          /** Un niveau est acquis quand TOUTES ses compétences le sont. */
          completed as (
            select a."student_id", a."level_id",
                   max(a."achieved_at") as completed_at,
                   count(*) as achieved_count,
                   (select count(*) from "skill" s where s."level_id" = a."level_id") as total
              from achieved a
             group by a."student_id", a."level_id"
          )
          select st."first_name",
                 l."name" as level_name,
                 l."color" as level_color,
                 (select count(*) from achieved a2
                   where a2."student_id" = st."id"
                     and to_char(a2."achieved_at" at time zone ${row.timezone}, 'YYYY-MM') = ${period}
                 ) as skills_this_month,
                 case when c."level_id" is not null
                       and to_char(c."completed_at" at time zone ${row.timezone}, 'YYYY-MM') = ${period}
                      then true else false end as badge_this_month
            from "student" st
            left join completed c
                   on c."student_id" = st."id" and c."achieved_count" = c."total"
            left join "level" l on l."id" = c."level_id"
           order by st."first_name", l."sort_order"
        `,
      );

      return rows as unknown as {
        first_name: string;
        level_name: string | null;
        level_color: string | null;
        skills_this_month: string | number;
        badge_this_month: boolean;
      }[];
    });

    const byChild = new Map<
      string,
      { firstName: string; badges: { name: string; color: string }[]; skillsAchieved: number }
    >();

    for (const child of children) {
      const entry = byChild.get(child.first_name) ?? {
        firstName: child.first_name,
        badges: [],
        skillsAchieved: Number(child.skills_this_month),
      };

      if (child.badge_this_month && child.level_name) {
        entry.badges.push({
          name: child.level_name,
          color: child.level_color ?? "#000000",
        });
      }

      byChild.set(child.first_name, entry);
    }

    reports.push({
      familyId: row.id,
      recipient: row.email,
      guardianName: row.primary_guardian_name,
      preferredLanguage: row.preferred_language,
      schoolName: row.school_name,
      children: [...byChild.values()],
    });
  }

  return reports;
}

/**
 * Un rapport mérite-t-il d'être envoyé ?
 *
 * Un mois sans progrès ne produit **jamais** un « 0 » sec. Un e-mail mensuel
 * qui n'apprend rien apprend surtout à ne plus ouvrir les suivants : le rapport
 * doit être un événement, pas une échéance. La famille est donc sautée, et
 * l'école le voit dans le récapitulatif.
 */
export function isReportWorthSending(report: MonthlyReport): boolean {
  return report.children.some(
    (child) => child.badges.length > 0 || child.skillsAchieved > 0,
  );
}
