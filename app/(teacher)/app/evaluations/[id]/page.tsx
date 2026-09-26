import { requireTeacher } from "@/lib/auth/server";
import View from "./view";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireTeacher();
  const { eleve } = await searchParams;
  return <View initialStudentId={typeof eleve === "string" ? eleve : undefined} />;
}
