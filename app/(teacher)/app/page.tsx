import { requireTeacher } from "@/lib/auth/server";
import { loadTeacherWorkQueue } from "./pedagogy-actions";
import View from "./view";
export default async function Page() {
  await requireTeacher();
  return <View workQueue={await loadTeacherWorkQueue()} />;
}
