import type { ClassInfo } from "@/lib/types";
import { students } from "@/lib/data/students";

export const currentTeacher = "Mme Martin";

export const classes: ClassInfo[] = [
  {
    id: "seconde-3",
    name: "Seconde 3",
    level: "Seconde",
    subject: "Mathématiques",
    teacher: currentTeacher,
    studentIds: students.filter((s) => s.classId === "seconde-3").map((s) => s.id),
  },
];

export const classById = new Map(classes.map((c) => [c.id, c]));
