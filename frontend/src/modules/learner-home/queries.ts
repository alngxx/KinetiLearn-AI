import { useQuery } from "@tanstack/react-query"
import {
  listMyClassExercises,
  listMyClasses,
  type MyClass,
  type MyExercise,
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

export type { MyClass, MyExercise }
