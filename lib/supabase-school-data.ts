import "server-only";

import { createAuthClient } from "@/lib/auth/server";
import { readSchoolData } from "@/lib/school-data-reader";
import type { SupabaseSchoolData } from "@/lib/school-data-shape";

export { EMPTY_SUPABASE_SCHOOL_DATA, type SupabaseSchoolData } from "@/lib/school-data-shape";

/** Display-only name from Auth metadata, used when the profile has none. */
export function teacherDisplayName(teacher: {
  user_metadata?: Record<string, unknown>;
}) {
  const value = teacher.user_metadata?.display_name;
  return typeof value === "string" && value.trim() ? value.trim() : "Professeur";
}

export async function loadSupabaseSchoolData(options: {
  teacherId: string;
}): Promise<SupabaseSchoolData> {
  const supabase = await createAuthClient();
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  return readSchoolData(supabase, options.teacherId);
}

