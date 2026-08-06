"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ATTENDANCE_STATUSES,
  attendanceQueueKey,
  QUEUE_RETRY_DELAY_MS,
  type AttendanceStatus,
} from "@/config/attendance";
import type { AttendanceRosterEntry, CoachSession } from "@/db/queries";
import type { AttendanceEntry } from "@/app/[locale]/today/actions";
import { cn } from "@/lib/utils";

/**
 * Feuille de présence du bord du bassin.
 *
 * ── Pourquoi ce composant est le seul état client du projet ──────────────────
 *
 * Partout ailleurs, BadgeLane est fait de composants serveur et de formulaires.
 * Ici le réseau tombe — béton, humidité, tablette au bout du bassin — et
 * l'information ne peut pas attendre. Chaque tap est donc appliqué
 * immédiatement à l'écran, puis mis dans une file locale qui survit à la
 * coupure **et au rechargement de la page**.
 *
 * ── Ce qui rend la file sûre ─────────────────────────────────────────────────
 *
 * La contrainte d'unicité (séance, élève) en base transforme chaque envoi en
 * `upsert`. Rejouer la file produit donc exactement le même état, jamais un
 * doublon. Sans cette propriété, retenter serait dangereux — et une file qu'on
 * ne peut pas retenter ne sert à rien.
 *
 * ── Deux détails qui comptent ────────────────────────────────────────────────
 *
 * La file est **clée par (séance, élève)**, pas par ordre de clic. Un coach qui
 * tape présent, se ravise en absent, puis revient à présent produit UNE entrée
 * en attente, pas trois : on met en file un état, pas un historique de gestes.
 *
 * Elle est **cloisonnée par membre du personnel**. Sur une tablette partagée,
 * les taps d'un coach ne partent jamais sous la session d'un autre — le serveur
 * enregistre toujours sa propre session, donc l'attribution est correcte sans
 * qu'il faille croire le navigateur.
 */

type QueuedEntry = AttendanceEntry;

function entryKey(occurrenceId: string, studentId: string): string {
  return `${occurrenceId}:${studentId}`;
}

export function AttendanceSheet({
  sessions,
  staffUserId,
  canWrite,
  submit,
}: {
  sessions: CoachSession[];
  staffUserId: string;
  canWrite: boolean;
  submit: (entries: AttendanceEntry[]) => Promise<{ ok: boolean }>;
}) {
  const t = useTranslations("today");

  /** État affiché : ce que le serveur sait, écrasé par ce qui est en attente. */
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() => {
    const initial: Record<string, AttendanceStatus> = {};
    for (const session of sessions) {
      for (const entry of session.roster) {
        if (entry.status) {
          initial[entryKey(session.occurrenceId, entry.studentId)] =
            entry.status;
        }
      }
    }
    return initial;
  });

  const [queue, setQueue] = useState<QueuedEntry[]>([]);
  const [online, setOnline] = useState(true);
  const flushing = useRef(false);

  const storageKey = attendanceQueueKey(staffUserId);

  /**
   * Reprise après rechargement : la file survit à la fermeture de l'onglet.
   *
   * React 19 déconseille de poser un état depuis un effet, à cause des rendus
   * en cascade. C'est ici le seul endroit possible : `localStorage` n'existe
   * pas pendant le rendu serveur, et le lire dans l'initialiseur de `useState`
   * produirait une divergence d'hydratation — exactement le défaut rencontré
   * en Semaine 4 avec les noms de langues.
   *
   * Le coût est d'un rendu supplémentaire au montage, une seule fois.
   */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;

      const parsed = JSON.parse(stored) as QueuedEntry[];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- voir le commentaire ci-dessus
      setQueue(parsed);
      setMarks((current) => {
        const merged = { ...current };
        for (const entry of parsed) {
          merged[entryKey(entry.occurrenceId, entry.studentId)] = entry.status;
        }
        return merged;
      });
    } catch {
      /** Une file illisible est écartée : mieux vaut repartir que planter. */
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      if (queue.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(queue));
    } catch {
      /** Stockage plein ou refusé : la file reste en mémoire, sans bloquer. */
    }
  }, [queue, storageKey]);

  const flush = useCallback(async () => {
    if (flushing.current || queue.length === 0) return;

    flushing.current = true;
    /** Instantané : un tap arrivé pendant l'envoi ne doit pas être perdu. */
    const snapshot = queue;

    try {
      const result = await submit(snapshot);

      if (result.ok) {
        setQueue((current) =>
          current.filter(
            (entry) =>
              !snapshot.some(
                (sent) =>
                  sent.occurrenceId === entry.occurrenceId &&
                  sent.studentId === entry.studentId &&
                  sent.status === entry.status,
              ),
          ),
        );
        setOnline(true);
      }
    } catch {
      /** Réseau absent ou serveur injoignable : on garde et on retentera. */
      setOnline(false);
    } finally {
      flushing.current = false;
    }
  }, [queue, submit]);

  /**
   * Vidage à l'arrivée d'un tap, au retour du réseau, et par réessai régulier.
   *
   * Même dérogation : `flush` pose un état, et la première tentative doit
   * partir dès le montage — une file restaurée après rechargement ne doit pas
   * attendre le prochain intervalle pour être envoyée.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- voir le commentaire ci-dessus
    void flush();

    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = window.setInterval(() => void flush(), QUEUE_RETRY_DELAY_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, [flush]);

  const mark = useCallback(
    (occurrenceId: string, studentId: string, status: AttendanceStatus) => {
      setMarks((current) => ({
        ...current,
        [entryKey(occurrenceId, studentId)]: status,
      }));

      setQueue((current) => [
        /** Clé par élève : on remplace l'état en attente, on n'empile pas. */
        ...current.filter(
          (entry) =>
            !(
              entry.occurrenceId === occurrenceId &&
              entry.studentId === studentId
            ),
        ),
        { occurrenceId, studentId, status },
      ]);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <p
        role="status"
        className={cn(
          "rounded-md px-3 py-2 text-sm",
          queue.length === 0
            ? "text-muted-foreground"
            : "bg-muted text-foreground font-medium",
        )}
      >
        {queue.length === 0
          ? t("allSaved")
          : online
            ? t("saving", { count: queue.length })
            : t("offlinePending", { count: queue.length })}
      </p>

      {sessions.map((session) => (
        <section key={session.occurrenceId} className="flex flex-col gap-2">
          <header
            className="border-s-4 ps-3"
            style={{ borderInlineStartColor: session.levelColor }}
          >
            <h2 className="font-heading text-lg font-semibold">
              {session.startTime.slice(0, 5)} · {session.title}
            </h2>
            <p className="text-muted-foreground text-sm">
              {session.levelName} · {session.locationName}
            </p>
          </header>

          {session.roster.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noStudents")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {session.roster.map((entry) => (
                <StudentRow
                  key={entry.studentId}
                  entry={entry}
                  status={marks[entryKey(session.occurrenceId, entry.studentId)]}
                  canWrite={canWrite}
                  onMark={(status) =>
                    mark(session.occurrenceId, entry.studentId, status)
                  }
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function StudentRow({
  entry,
  status,
  canWrite,
  onMark,
}: {
  entry: AttendanceRosterEntry;
  status: AttendanceStatus | undefined;
  canWrite: boolean;
  onMark: (status: AttendanceStatus) => void;
}) {
  const t = useTranslations("today");

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-medium">{entry.studentName}</p>
        {/*
          Les notes médicales sont affichées d'emblée, sans repli à déplier :
          au bord du bassin, une allergie ou un asthme doit se voir sans geste
          supplémentaire.
        */}
        {entry.medicalNotes ? (
          <p className="text-destructive text-sm text-pretty">
            {entry.medicalNotes}
          </p>
        ) : null}
      </div>

      <div className="flex gap-1">
        {ATTENDANCE_STATUSES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            disabled={!canWrite}
            onClick={() => onMark(candidate)}
            aria-pressed={status === candidate}
            className={cn(
              /* Cibles larges : on tape avec un doigt mouillé, debout. */
              "min-h-11 min-w-16 rounded-md px-3 text-sm transition-colors",
              status === candidate
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-muted text-muted-foreground hover:text-foreground",
              !canWrite && "opacity-50",
            )}
          >
            {t(candidate)}
          </button>
        ))}
      </div>
    </li>
  );
}
