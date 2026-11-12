import { requireTeacher } from "@/lib/auth/server";
import EditEvaluation from "./view";
export default async function Page() {
  await requireTeacher();
  return <EditEvaluation />;
}
