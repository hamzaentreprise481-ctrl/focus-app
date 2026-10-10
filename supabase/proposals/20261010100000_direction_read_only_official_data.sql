-- PROPOSAL — NOT IN supabase/migrations, NOT APPLIED ANYWHERE.
-- FOCUS Direction uses the existing school_memberships role 'admin'. The
-- Direction app only reads, but the database still grants that role, through
-- the permissive policies of the base schema, direct writes that the product
-- contract does not give the direction:
--   * official pedagogical data of any assessment of the school: assessments
--     (update, delete), results, competency levels, recorded answers,
--     questions and corrections, subject files, question notions;
--   * self-escalation: an admin can add a 'teacher' membership for their own
--     account (the unique key is school × user × role) and assign themselves
--     to any class and subject, which opens the Teacher space and its writes.
--
-- This proposal adds RESTRICTIVE policies for `authenticated` (ANDed with the
-- existing permissive ones, which are not restated):
--   * official pedagogical data: only the assessment's own teacher writes —
--     exactly what the permissive policies already allow teachers, without
--     the "or is_school_admin" branch;
--   * school_memberships and teacher_assignments: no one writes a row about
--     their own account. The admin keeps managing everyone else's.
-- service_role (provisioning scripts) and SECURITY DEFINER functions are not
-- concerned. Unchanged and reported: the audited
-- focus_review_pedagogical_recommendation still lets the school admin
-- confirm or dismiss a hypothesis (Teacher contract), and the admin still
-- administers the school structure (classes, subjects, référentiel,
-- enrollments, other accounts' memberships and assignments).
--
-- Independent of the pending Teacher migrations (20261007090000,
-- 20261007130000, 20261009120000); tested on every migration and on the live
-- head 20261004090000 by tests/direction-read-only-proposal-db.test.ts.
-- Rollback: supabase/proposals/20261010100000_direction_read_only_official_data.down.sql.
-- To adopt it, the owner moves it into supabase/migrations (staging first).

-- Assessments: the permissive INSERT already requires teacher_id = auth.uid().
create policy assessments_owner_update on public.assessments
  as restrictive for update to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));
create policy assessments_owner_delete on public.assessments
  as restrictive for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- Results.
create policy assessment_results_owner_insert on public.assessment_results
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy assessment_results_owner_update on public.assessment_results
  as restrictive for update to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy assessment_results_owner_delete on public.assessment_results
  as restrictive for delete to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())));

-- Competency levels.
create policy competency_results_owner_insert on public.competency_results
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.assessment_results ar
                      join public.assessments a on a.id = ar.assessment_id
                      where ar.id = assessment_result_id and a.teacher_id = (select auth.uid())));
create policy competency_results_owner_update on public.competency_results
  as restrictive for update to authenticated
  using (exists (select 1 from public.assessment_results ar
                 join public.assessments a on a.id = ar.assessment_id
                 where ar.id = assessment_result_id and a.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.assessment_results ar
                      join public.assessments a on a.id = ar.assessment_id
                      where ar.id = assessment_result_id and a.teacher_id = (select auth.uid())));
create policy competency_results_owner_delete on public.competency_results
  as restrictive for delete to authenticated
  using (exists (select 1 from public.assessment_results ar
                 join public.assessments a on a.id = ar.assessment_id
                 where ar.id = assessment_result_id and a.teacher_id = (select auth.uid())));

-- Recorded answers, questions and corrections, subject files.
create policy student_responses_owner_insert on public.student_responses
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy student_responses_owner_update on public.student_responses
  as restrictive for update to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy student_responses_owner_delete on public.student_responses
  as restrictive for delete to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())));

create policy assessment_questions_owner_insert on public.assessment_questions
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy assessment_questions_owner_update on public.assessment_questions
  as restrictive for update to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy assessment_questions_owner_delete on public.assessment_questions
  as restrictive for delete to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())));

create policy assessment_materials_owner_insert on public.assessment_materials
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy assessment_materials_owner_update on public.assessment_materials
  as restrictive for update to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.assessments a
                      where a.id = assessment_id and a.teacher_id = (select auth.uid())));
create policy assessment_materials_owner_delete on public.assessment_materials
  as restrictive for delete to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id and a.teacher_id = (select auth.uid())));

-- Notions assessed by each question.
create policy question_curriculum_nodes_owner_insert on public.question_curriculum_nodes
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.assessment_questions q
                      join public.assessments a on a.id = q.assessment_id
                      where q.id = question_id and a.teacher_id = (select auth.uid())));
create policy question_curriculum_nodes_owner_update on public.question_curriculum_nodes
  as restrictive for update to authenticated
  using (exists (select 1 from public.assessment_questions q
                 join public.assessments a on a.id = q.assessment_id
                 where q.id = question_id and a.teacher_id = (select auth.uid())))
  with check (exists (select 1 from public.assessment_questions q
                      join public.assessments a on a.id = q.assessment_id
                      where q.id = question_id and a.teacher_id = (select auth.uid())));
create policy question_curriculum_nodes_owner_delete on public.question_curriculum_nodes
  as restrictive for delete to authenticated
  using (exists (select 1 from public.assessment_questions q
                 join public.assessments a on a.id = q.assessment_id
                 where q.id = question_id and a.teacher_id = (select auth.uid())));

-- No self-escalation: nobody writes a membership or an assignment of their
-- own account (per command, so reading one's own rows is unaffected).
create policy school_memberships_not_self_insert on public.school_memberships
  as restrictive for insert to authenticated
  with check (user_id <> (select auth.uid()));
create policy school_memberships_not_self_update on public.school_memberships
  as restrictive for update to authenticated
  using (user_id <> (select auth.uid()))
  with check (user_id <> (select auth.uid()));
create policy school_memberships_not_self_delete on public.school_memberships
  as restrictive for delete to authenticated
  using (user_id <> (select auth.uid()));

create policy teacher_assignments_not_self_insert on public.teacher_assignments
  as restrictive for insert to authenticated
  with check (teacher_id <> (select auth.uid()));
create policy teacher_assignments_not_self_update on public.teacher_assignments
  as restrictive for update to authenticated
  using (teacher_id <> (select auth.uid()))
  with check (teacher_id <> (select auth.uid()));
create policy teacher_assignments_not_self_delete on public.teacher_assignments
  as restrictive for delete to authenticated
  using (teacher_id <> (select auth.uid()));
