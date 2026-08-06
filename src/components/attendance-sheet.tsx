"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import type { AttendanceEntry } from "@/app/[locale]/today/actions";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/config/attendance";
import { pendingQueueKey, QUEUE_RETRY_DELAY_MS } from "@/config/pending-queue";
import type { AttendanceRosterEntry, CoachSession } from "@/db/queries";
import { usePendingQueue } from "@/hooks/use-pending-queue";
import { cn } from "@/lib/utils";

/**
 * Feuille de présence du bord du bassin.
 *
 * ── Un seul état, pas deux ───────────────────────────────────────────────────
 *
 * Ce qui s'affiche est **ce qui est en attente, sinon ce que sait le serveur**.
 * Il n'existe plus d'état d'affichage séparé pouvant diverger de la file : la
 * file *est* la source de vérité de ce qui n'est pas encore confirmé.
 *
 * La mécanique de durabilité — persistance, rejeu, reconnexion — vit dans
 * `usePendingQueue`, partagée avec la feuille de progression. Ce composant ne
 * décrit que ce qu'on met en file et comment on l'affiche.
 */

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

  const dedupeKey = useCallback(
    (entry: AttendanceEntry) => entryKey(entry.occurrenceId, entry.studentId),
    [],
  );

  const { pending, pendingCount, online, enqueue } =
    usePendingQueue<AttendanceEntry>({
      storageKey: pendingQueueKey("attendance", staffUserId),
      dedupeKey,
      submit,
      retryDelayMs: QUEUE_RETRY_DELAY_MS,
    });

  return (
    <div className="flex flex-col gap-6">
      <p
        role="status"
        className={cn(
          "rounded-md px-3 py-2 text-sm",
          pendingCount === 0
            ? "text-muted-foreground"
            : "bg-muted text-foreground font-medium",
        )}
      >
        {pendingCount === 0
          ? t("allSaved")
          : online
            ? t("saving", { count: pendingCount })
            : t("offlinePending", { count: pendingCount })}
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
                  /** En attente si présent, sinon ce que sait le serveur. */
                  status={
                    pending.get(entryKey(session.occurrenceId, entry.studentId))
                      ?.status ?? entry.status
                  }
                  canWrite={canWrite}
                  onMark={(status) =>
                    enqueue({
                      occurrenceId: session.occurrenceId,
                      studentId: entry.studentId,
                      status,
                    })
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
  status: AttendanceStatus | null;
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
