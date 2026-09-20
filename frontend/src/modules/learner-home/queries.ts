import { useMutation, useQuery } from "@tanstack/react-query"
import { startDownload } from "@/lib/download"
import {
  getClassDocumentDownload,
  listMyClassDocuments,
  listMyClassExercises,
  listMyClasses,
  listMySubmissions,
  type MyClass,
  type MyClassDocument,
  type MyExercise,
  type MySubmission,
} from "@/modules/learner-home/api"

export function useMyClasses() {
  return useQuery({
    queryKey: ["my-classes"],
    queryFn: listMyClasses,
  })
}

export function useMyClassExercises(classId: string) {
  return useQuery({
    queryKey: ["my-class-exercises", classId],
    queryFn: () => listMyClassExercises(classId),
  })
}

export function useMyClassDocuments(classId: string) {
  return useQuery({
    queryKey: ["my-class-documents", classId],
    queryFn: () => listMyClassDocuments(classId),
  })
}

// A mutation rather than a query: the URL it returns expires in minutes, so it
// is fetched when the learner asks for it and never cached. One of these per
// row, so a download in flight only disables its own button.
export function useClassDocumentDownload(classId: string) {
  return useMutation({
    mutationFn: (documentId: string) => getClassDocumentDownload(classId, documentId),
    onSuccess: (data) => startDownload(data.url),
  })
}

export function useMySubmissions(classId: string) {
  return useQuery({
    queryKey: ["my-submissions", classId],
    queryFn: () => listMySubmissions(classId),
  })
}

// The attempt the card's Best figure refers to — best_score is MAX(score), so
// the link has to land on that attempt and not merely the latest one. The list
// arrives newest first, so the first row at the top score breaks the tie the
// way a learner would expect. Unscored rows have nothing to compare.
export function bestSubmissionByExercise(rows: MySubmission[]): Map<string, string> {
  const best = new Map<string, { id: string; score: number }>()
  for (const row of rows) {
    if (row.score === null) continue
    const current = best.get(row.exercise_id)
    if (current === undefined || row.score > current.score) {
      best.set(row.exercise_id, { id: row.id, score: row.score })
    }
  }
  return new Map([...best].map(([exerciseId, row]) => [exerciseId, row.id]))
}

export type { MyClass, MyClassDocument, MyExercise, MySubmission }
