import { requireTeacher } from "@/lib/auth/server";
import View from "./view";

// The analysis Server Actions of this page call the model (up to 90 s per
// copy, and scan-stack extraction can process a whole PDF: allow 300 s.
export const maxDuration = 300;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireTeacher();
  const { eleve } = await searchParams;
  return <View initialStudentId={typeof eleve === "string" ? eleve : undefined} />;
}
