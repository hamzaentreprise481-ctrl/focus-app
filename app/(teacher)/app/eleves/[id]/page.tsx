import { requireTeacher } from "@/lib/auth/server";
import View from "./view";

// The analysis Server Actions of this page call the model (up to 90 s per
// copy, MODEL_TIMEOUT_MS) and then record the result: allow 120 s.
export const maxDuration = 120;
export default async function Page() {
  await requireTeacher();
  return <View />;
}
