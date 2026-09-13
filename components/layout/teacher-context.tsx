"use client";
import { createContext, useContext } from "react";
const TeacherContext = createContext<{ name: string; id: string } | null>(null);
export function TeacherProvider({
  children,
  name,
  id,
}: {
  children: React.ReactNode;
  name: string;
  id: string;
}) {
  return (
    <TeacherContext.Provider value={{ name, id }}>
      {children}
    </TeacherContext.Provider>
  );
}
export function useTeacher() {
  const teacher = useContext(TeacherContext);
  if (!teacher)
    throw new Error("Teacher context requires an authenticated layout.");
  return teacher;
}
