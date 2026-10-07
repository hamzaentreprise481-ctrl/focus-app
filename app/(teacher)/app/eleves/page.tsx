import { requireTeacher } from "@/lib/auth/server";
import View from "./view";
export default async function Page() {
  await requireTeacher();
  return <View />;
}
