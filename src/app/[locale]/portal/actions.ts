"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import { hasLiveEnrollment, lockKlassAndCountSeats } from "@/db/enrollment";
import {
  classOccurrence,
  enrollment,
  family,
  klass,
  makeupCredit,
  organization,
  student,
  term,
} from "@/db/schema";
import { rosterWindowCondition } from "@/db/roster";
import { CANCELLED_OCCURRENCE_STATUS } from "@/config/scheduling";
import { ROSTER_EXCLUDED_STATUSES } from "@/config/enrollment";
import { MAKEUP_OCCUPYING_STATUSES } from "@/config/makeup";
import { isMakeupUsable } from "@/lib/makeup";
import type { ActionResult } from "@/lib/action-result";
import { requiredUuid, ValidationError } from "@/lib/actions";
import { todayInTimeZone } from "@/lib/occurrences";
import { runParentAction } from "@/lib/parent-actions";
import { redirect } from "next/navigation";
import { clientEnv } from "@/config/env.client";
import { CUSTOMER_PORTAL_LOCALE } from "@/config/billing";
import { forConnectedAccount, getStripe } from "@/lib/stripe";
import { resolveParentPortalConfiguration } from "@/lib/stripe-portal";
import type { Locale } from "@/config/i18n";

/**
 * La première écriture qu'un parent fait dans BadgeLane.
 *
 * ── Rien de neuf sous le capot ───────────────────────────────────────────────
 *
 * Elle appelle `lockKlassAndCountSeats` — le verrou de la Semaine 5 — sans le
 * recopier ni l'adapter. Une seconde implémentation « côté parent » aurait
 * divergé le jour où l'une des deux serait corrigée, et le surbooking serait
 * revenu par la porte qu'on n'aurait pas regardée.
 *
 * Le décompte, lui, passe par `count_seats_taken` : sous contexte famille, une
 * lecture directe d'`enrollment` ne verrait que les inscriptions du foyer et
 * croirait tout cours vide.
 *
 * ── Le choix n'est pas offert ────────────────────────────────────────────────
 *
 * Inscription ou liste d'attente découle du décompte fait **sous verrou**. Le
 * nombre affiché à l'écran peut être périmé au moment du clic — c'est normal,
 * et c'est même le cas intéressant : si la classe s'est remplie entre-temps, le
 * parent atterrit en liste d'attente au lieu de recevoir une erreur. Le nombre
 * affiché informe ; le verrou décide.
 *
 * ── Ce qui est écrit en plus ─────────────────────────────────────────────────
 *
 * `enrolledByGuardianId` : la provenance. C'est elle qui permettra à l'école de
 * relire ce que les familles ont fait — et sans cette relecture, « l'école
 * garde la main » ne voudrait rien dire.
 */
export async function enrolChild(
  locale: Locale,
  formData: FormData,
): Promise<ActionResult> {
  const familyId = requiredUuid(formData, "familyId");

  return runParentAction(
    locale,
    "enrollment:self",
    familyId,
    async (context, tx) => {
      const klassId = requiredUuid(formData, "klassId");
      const studentId = requiredUuid(formData, "studentId");

      /**
       * L'élève appartient-il au foyer ? La RLS le garantit déjà — le contexte
       * famille est posé — mais on le lit explicitement pour distinguer
       * « pas ton enfant » d'un cours introuvable, et servir le bon message.
       */
      const [owned] = await tx
        .select({ id: student.id })
        .from(student)
        .where(eq(student.id, studentId))
        .limit(1);

      if (!owned) {
        throw new ValidationError(
          "Cet élève n'appartient pas à ce foyer.",
          "notInThisSchool",
        );
      }

      /** Verrouille le cours : à partir d'ici, le décompte ne peut plus bouger. */
      const seats = await lockKlassAndCountSeats(
        tx,
        context.organizationId,
        klassId,
      );

      /**
       * Le double-tap d'un pouce sur un réseau capricieux ne doit pas produire
       * une erreur technique, mais le message qui explique la situation.
       */
      if (
        await hasLiveEnrollment(
          tx,
          context.organizationId,
          klassId,
          studentId,
        )
      ) {
        throw new ValidationError(
          "Cet élève a déjà une inscription en cours sur ce cours.",
          "alreadyEnrolled",
        );
      }

      const [school] = await tx
        .select({ timezone: organization.timezone })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!school) {
        throw new ValidationError("École introuvable.", "notInThisSchool");
      }

      /** Le jour de l'école, pas celui du serveur qui enregistre. */
      const today = todayInTimeZone(school.timezone);

      await tx.insert(enrollment).values({
        organizationId: context.organizationId,
        klassId,
        studentId,
        status: seats.hasSeat ? "active" : "waitlisted",
        startDate: seats.hasSeat ? today : null,
        waitlistedAt: seats.hasSeat ? null : new Date(),
        enrolledByGuardianId: context.guardianId,
      });
    },
  ).then((result) => {
    revalidatePath(`/[locale]${routes.portal}`, "page");
    revalidatePath(`/[locale]${routes.schedule}`, "page");
    revalidatePath(`/[locale]${routes.dashboard}`, "page");
    return result;
  });
}

/**
 * Ouvre le portail Stripe du parent — moyen de paiement et historique.
 *
 * ── La configuration est ÉPINGLÉE, jamais déléguée ──────────────────────────
 *
 * `resolveParentPortalConfiguration` garantit une configuration à nous, avec
 * l'annulation d'abonnement désactivée. Laisser Stripe appliquer celle de
 * l'école rouvrirait par une autre porte le pouvoir qu'on a refusé au parent en
 * Temps 2a : libérer une place déclenche une promotion de liste d'attente que
 * personne n'a validée.
 *
 * ── Le client Stripe se DÉRIVE ──────────────────────────────────────────────
 *
 * Il n'est jamais reçu du formulaire. Le formulaire ne porte que le foyer, lui
 * même revérifié contre les rattachements de la session. Le recevoir
 * reviendrait à laisser choisir de qui l'on paie les factures — et aucune clé
 * étrangère ne dirait rien, exactement comme elle ne disait rien sur les
 * niveaux inter-écoles en Semaine 3.
 *
 * ── Le retour n'affirme rien ────────────────────────────────────────────────
 *
 * `return_url` ramène sur la liste des factures, qui ne connaît que le miroir.
 * L'écran est donc *incapable* d'annoncer un paiement : seul le webhook signé
 * fait passer une facture à `paid`.
 */
export async function openParentBillingPortal(
  locale: Locale,
  formData: FormData,
): Promise<ActionResult> {
  const familyId = requiredUuid(formData, "familyId");
  let destination: string | null = null;

  const result = await runParentAction(
    locale,
    "enrollment:self",
    familyId,
    async (context, tx) => {
      const stripe = getStripe();
      if (!stripe) {
        throw new ValidationError("Stripe non configuré.", "stripeNotConfigured");
      }

      const [school] = await tx
        .select({ stripeAccountId: organization.stripeAccountId })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!school?.stripeAccountId) {
        throw new ValidationError(
          "L'école n'a pas encore connecté son compte Stripe.",
          "stripeNotConnected",
        );
      }

      /** Dérivé du foyer authentifié — jamais du formulaire. */
      const [household] = await tx
        .select({ customerId: family.stripeCustomerId })
        .from(family)
        .where(eq(family.id, context.familyId))
        .limit(1);

      if (!household?.customerId) {
        throw new ValidationError(
          "Cette famille n'a pas encore de dossier de paiement.",
          "familyNotBilledYet",
        );
      }

      const scoped = forConnectedAccount(school.stripeAccountId);
      const configuration = await resolveParentPortalConfiguration(stripe, scoped);

      const session = await stripe.billingPortal.sessions.create(
        {
          customer: household.customerId,
          configuration,
          locale: CUSTOMER_PORTAL_LOCALE,
          return_url: `${clientEnv.NEXT_PUBLIC_APP_URL}/${locale}${routes.portal}`,
        },
        scoped,
      );

      destination = session.url;
    },
  );

  if (destination) redirect(destination);

  return result;
}

/**
 * Signale l'absence d'un enfant à une séance à venir, et crée le crédit.
 *
 * ── La boucle fermée : un rattrapage n'engendre pas un rattrapage ───────────
 *
 * Le crédit ne naît que d'une séance où l'enfant est **régulièrement inscrit**
 * — la fenêtre de roster de la Semaine 6. Sans cette borne, une séance de
 * rattrapage étant elle-même une occurrence future, le parent y signalerait une
 * absence et fabriquerait un second crédit, puis un troisième. La génération
 * est adossée à l'inscription, jamais à une réservation.
 *
 * ── Seulement le futur ──────────────────────────────────────────────────────
 *
 * Une séance passée porte peut-être déjà un relevé de présence. Y signaler une
 * absence réécrirait l'histoire — même règle que le planning et la feuille
 * d'appel : le passé est immuable.
 *
 * ── Une absence, un crédit ──────────────────────────────────────────────────
 *
 * L'unicité `(école, élève, séance manquée)` rend le double-tap inoffensif : le
 * second essai tombe sur une violation de contrainte, traduite en message, au
 * lieu de créer une seconde ligne.
 */
export async function reportAbsence(
  locale: Locale,
  formData: FormData,
): Promise<ActionResult> {
  const familyId = requiredUuid(formData, "familyId");

  return runParentAction(
    locale,
    "makeup:self",
    familyId,
    async (context, tx) => {
      const studentId = requiredUuid(formData, "studentId");
      const occurrenceId = requiredUuid(formData, "occurrenceId");

      const [school] = await tx
        .select({ timezone: organization.timezone })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!school) {
        throw new ValidationError("École introuvable.", "notInThisSchool");
      }

      const today = todayInTimeZone(school.timezone);

      const [occurrence] = await tx
        .select({
          id: classOccurrence.id,
          klassId: classOccurrence.klassId,
          date: classOccurrence.date,
          status: classOccurrence.status,
        })
        .from(classOccurrence)
        .where(eq(classOccurrence.id, occurrenceId))
        .limit(1);

      if (!occurrence || occurrence.status === CANCELLED_OCCURRENCE_STATUS) {
        throw new ValidationError("Séance introuvable.", "notInThisSchool");
      }

      if (occurrence.date <= today) {
        throw new ValidationError(
          "Cette séance n'est pas à venir.",
          "occurrencePassed",
        );
      }

      /**
       * L'enfant est-il **inscrit** à ce cours à cette date ? La condition est
       * celle de la Semaine 6, réutilisée telle quelle : la recopier créerait
       * une seconde définition du roster.
       */
      const [enrolled] = await tx
        .select({ id: enrollment.id })
        .from(enrollment)
        .where(
          and(
            rosterWindowCondition(
              context.organizationId,
              [occurrence.klassId],
              occurrence.date,
            ),
            eq(enrollment.studentId, studentId),
          ),
        )
        .limit(1);

      if (!enrolled) {
        throw new ValidationError(
          "Cet enfant n'est pas inscrit à cette séance.",
          "notEnrolledInSession",
        );
      }

      await tx.insert(makeupCredit).values({
        organizationId: context.organizationId,
        studentId,
        missedOccurrenceId: occurrenceId,
      });
    },
  ).then((result) => {
    revalidatePath(`/[locale]${routes.portal}`, "page");
    return result;
  });
}

/**
 * Réserve un crédit de rattrapage dans une autre séance.
 *
 * ── Quatre refus, dans cet ordre ────────────────────────────────────────────
 *
 * 1. **Même niveau.** Un rattrapage se place dans une séance du niveau ACTUEL
 *    de l'enfant. Ce n'est pas une contrainte administrative : c'est de l'eau
 *    plus profonde et un encadrement pensé pour un autre public. La règle
 *    diffère volontairement de l'inscription, où aucun filtre n'a été posé —
 *    là-bas, l'enfant peut n'avoir aucun niveau ; ici il en a forcément un.
 * 2. **Pas déjà attendu.** Un enfant déjà au roster de cette séance y compterait
 *    deux corps. Vérifié au même endroit que la capacité, pas dans un écran.
 * 3. **Un crédit utilisable.** L'état est DÉRIVÉ — disponible, réservé, consommé
 *    ou expiré — et l'échéance se lit vivante sur la session. Une école qui
 *    prolonge son trimestre prolonge donc ses crédits.
 * 4. **La place.** Sous le verrou de la SÉANCE, jamais du cours.
 *
 * ── Le verrou porte sur l'occurrence ────────────────────────────────────────
 *
 * `count_seats_taken` compte les inscrits d'un cours ; un rattrapage ajoute un
 * corps à une seule séance. Deux réservations dans deux séances du même cours
 * n'ont aucune raison de s'attendre.
 */
export async function bookMakeup(
  locale: Locale,
  formData: FormData,
): Promise<ActionResult> {
  const familyId = requiredUuid(formData, "familyId");

  return runParentAction(
    locale,
    "makeup:self",
    familyId,
    async (context, tx) => {
      const creditId = requiredUuid(formData, "creditId");
      const occurrenceId = requiredUuid(formData, "occurrenceId");

      const [school] = await tx
        .select({ timezone: organization.timezone })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!school) {
        throw new ValidationError("École introuvable.", "notInThisSchool");
      }

      const today = todayInTimeZone(school.timezone);

      /** Le crédit, et l'échéance LUE sur la session — jamais figée. */
      const [credit] = await tx
        .select({
          id: makeupCredit.id,
          studentId: makeupCredit.studentId,
          status: makeupCredit.status,
          bookedOn: classOccurrence.date,
          bookedStatus: classOccurrence.status,
          usableThrough: sql<string | null>`coalesce(${makeupCredit.extendedUntil}, ${term.endDate})`,
          studentLevelId: student.currentLevelId,
        })
        .from(makeupCredit)
        .innerJoin(student, eq(student.id, makeupCredit.studentId))
        .innerJoin(
          classOccurrence,
          eq(classOccurrence.id, makeupCredit.missedOccurrenceId),
        )
        .innerJoin(klass, eq(klass.id, classOccurrence.klassId))
        .innerJoin(term, eq(term.id, klass.termId))
        .where(eq(makeupCredit.id, creditId))
        .limit(1);

      if (!credit) {
        throw new ValidationError("Crédit introuvable.", "notInThisSchool");
      }

      /**
       * L'état réservé se lit sur la séance CIBLE, pas sur la manquée. Un
       * crédit déjà posé ailleurs n'est pas réutilisable — sauf si cette
       * séance-là a été annulée, auquel cas la dérivation le rouvre seule.
       */
      const [target] = await tx
        .select({
          id: classOccurrence.id,
          klassId: classOccurrence.klassId,
          date: classOccurrence.date,
          status: classOccurrence.status,
          levelId: klass.levelId,
        })
        .from(classOccurrence)
        .innerJoin(klass, eq(klass.id, classOccurrence.klassId))
        .where(eq(classOccurrence.id, occurrenceId))
        .limit(1);

      if (!target || target.status === CANCELLED_OCCURRENCE_STATUS) {
        throw new ValidationError("Séance introuvable.", "notInThisSchool");
      }

      if (target.date <= today) {
        throw new ValidationError(
          "Cette séance n'est pas à venir.",
          "occurrencePassed",
        );
      }

      if (
        credit.studentLevelId === null ||
        credit.studentLevelId !== target.levelId
      ) {
        throw new ValidationError(
          "Cette séance n'est pas du niveau de l'enfant.",
          "wrongLevelForMakeup",
        );
      }

      const [alreadyThere] = await tx
        .select({ id: enrollment.id })
        .from(enrollment)
        .where(
          and(
            rosterWindowCondition(
              context.organizationId,
              [target.klassId],
              target.date,
            ),
            eq(enrollment.studentId, credit.studentId),
          ),
        )
        .limit(1);

      if (alreadyThere) {
        throw new ValidationError(
          "Cet enfant est déjà attendu à cette séance.",
          "alreadyOnRoster",
        );
      }

      const [bookedTarget] = credit.status === "booked"
        ? await tx
            .select({ date: classOccurrence.date, status: classOccurrence.status })
            .from(makeupCredit)
            .innerJoin(
              classOccurrence,
              eq(classOccurrence.id, makeupCredit.bookedOccurrenceId),
            )
            .where(eq(makeupCredit.id, creditId))
            .limit(1)
        : [];

      const usable = isMakeupUsable({
        status: credit.status,
        usableThrough: credit.usableThrough,
        bookedOn: bookedTarget?.date ?? null,
        bookedOccurrenceStatus: bookedTarget?.status ?? null,
        today,
      });

      if (!usable) {
        throw new ValidationError(
          "Ce crédit n'est pas utilisable.",
          "noUsableCredit",
        );
      }

      /** Verrouille la SÉANCE : à partir d'ici le décompte ne bouge plus. */
      await tx.execute(
        sql`select 1 from ${classOccurrence}
            where ${classOccurrence.id} = ${occurrenceId} for update`,
      );

      const attending = Number(
        (
          await tx.execute(
            sql`select count_occurrence_attendees(
                  ${occurrenceId}::uuid,
                  ${sql.param([...ROSTER_EXCLUDED_STATUSES])}::text[],
                  ${sql.param([...MAKEUP_OCCUPYING_STATUSES])}::text[]
                ) as total`,
          )
        ).rows[0].total,
      );

      const [capacity] = await tx
        .select({ seats: klass.capacity })
        .from(klass)
        .where(eq(klass.id, target.klassId))
        .limit(1);

      if (attending >= (capacity?.seats ?? 0)) {
        throw new ValidationError("Cette séance est complète.", "classFull", {
          taken: attending,
          capacity: capacity?.seats ?? 0,
        });
      }

      await tx
        .update(makeupCredit)
        .set({ bookedOccurrenceId: occurrenceId, status: "booked" })
        .where(eq(makeupCredit.id, creditId));
    },
  ).then((result) => {
    revalidatePath(`/[locale]${routes.portal}`, "page");
    revalidatePath(`/[locale]${routes.today}`, "page");
    return result;
  });
}
