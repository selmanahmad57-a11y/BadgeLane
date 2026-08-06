"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import type { AttendanceEntry } from "@/app/[locale]/today/actions";
import type { ProgressEntry } from "@/app/[locale]/today/progress-actions";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/config/attendance";
import { PROGRESS_STATUSES } from "@/config/progress";
import { pendingQueueKey, QUEUE_RETRY_DELAY_MS } from "@/config/pending-queue";
import type { ProgressStatus } from "@/config/progress";
import type {
  AttendanceRosterEntry,
  CoachSession,
  StudentSkill,
} from "@/db/queries";
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
  poolsideSkills,
  staffUserId,
  canWrite,
  canMarkProgress,
  submit,
  submitProgress,
}: {
  sessions: CoachSession[];
  /** Compétences du niveau courant de chaque élève, indexées par élève. */
  poolsideSkills: Record<string, { levelName: string; entries: StudentSkill[] }>;
  staffUserId: string;
  canWrite: boolean;
  canMarkProgress: boolean;
  submit: (entries: AttendanceEntry[]) => Promise<{ ok: boolean }>;
  submitProgress: (entries: ProgressEntry[]) => Promise<{ ok: boolean }>;
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

  /**
   * Seconde file, même mécanique. Deux clés de stockage distinctes : un blocage
   * sur la présence ne doit pas figer les compétences, ni l'inverse.
   */
  const progressDedupeKey = useCallback(
    (entry: ProgressEntry) => `${entry.studentId}:${entry.skillId}`,
    [],
  );

  const progress = usePendingQueue<ProgressEntry>({
    storageKey: pendingQueueKey("progress", staffUserId),
    dedupeKey: progressDedupeKey,
    submit: submitProgress,
    retryDelayMs: QUEUE_RETRY_DELAY_MS,
  });

  const totalPending = pendingCount + progress.pendingCount;
  const bothOnline = online && progress.online;

  return (
    <div className="flex flex-col gap-6">
      <p
        role="status"
        className={cn(
          "rounded-md px-3 py-2 text-sm",
          totalPending === 0
            ? "text-muted-foreground"
            : "bg-muted text-foreground font-medium",
        )}
      >
        {totalPending === 0
          ? t("allSaved")
          : bothOnline
            ? t("saving", { count: totalPending })
            : t("offlinePending", { count: totalPending })}
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
                  skills={poolsideSkills[entry.studentId]}
                  canMarkProgress={canMarkProgress}
                  progressStatus={(skillId) =>
                    progress.pending.get(`${entry.studentId}:${skillId}`)
                      ?.status ?? undefined
                  }
                  onMarkProgress={(skillId, status) =>
                    progress.enqueue({
                      studentId: entry.studentId,
                      skillId,
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
  skills,
  canMarkProgress,
  progressStatus,
  onMarkProgress,
}: {
  entry: AttendanceRosterEntry;
  status: AttendanceStatus | null;
  canWrite: boolean;
  onMark: (status: AttendanceStatus) => void;
  skills: { levelName: string; entries: StudentSkill[] } | undefined;
  canMarkProgress: boolean;
  progressStatus: (skillId: string) => ProgressStatus | null | undefined;
  onMarkProgress: (skillId: string, status: ProgressStatus | null) => void;
}) {
  const t = useTranslations("today");

  return (
    <li className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
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
    </div>

      {/*
        Les compétences du niveau courant, dépliées sous l'élève. Le coach ne
        change pas d'écran au bord du bassin : l'appel et les acquis se font
        au même endroit, du même geste.
      */}
      {skills ? (
        <details className="ps-1">
          <summary className="text-muted-foreground cursor-pointer text-sm">
            {t("skillsOf", { level: skills.levelName })}
          </summary>

          <ul className="mt-2 flex flex-col gap-2">
            {skills.entries.map((item) => {
              const pendingValue = progressStatus(item.skillId);
              const current =
                pendingValue !== undefined ? pendingValue : item.status;

              return (
                <li
                  key={item.skillId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-sm">{item.name}</span>

                  <div className="flex gap-1">
                    {PROGRESS_STATUSES.map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        disabled={!canMarkProgress}
                        aria-pressed={current === candidate}
                        onClick={() =>
                          onMarkProgress(
                            item.skillId,
                            /** Retaper le même état retire la marque. */
                            current === candidate ? null : candidate,
                          )
                        }
                        className={cn(
                          "min-h-11 rounded-md px-3 text-sm transition-colors",
                          current === candidate
                            ? candidate === "achieved"
                              ? "bg-primary text-primary-foreground font-medium"
                              : "bg-muted-foreground/20 text-foreground font-medium"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                          !canMarkProgress && "opacity-50",
                        )}
                      >
                        {t(candidate)}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ) : (
        /** Sans niveau assigné, il n'y a rien à cocher — autant le dire. */
        <p className="text-muted-foreground ps-1 text-sm">{t("noLevel")}</p>
      )}
    </li>
  );
}
