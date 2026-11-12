-- Tighten V1 pedagogical AI RLS policies and index its new foreign keys.

drop policy if exists assessment_materials_write on public.assessment_materials;
create policy assessment_materials_insert on public.assessment_materials
  for insert to authenticated
  with check (
    updated_by = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = assessment_materials.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy assessment_materials_update on public.assessment_materials
  for update to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_materials.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  )
  with check (
    updated_by = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = assessment_materials.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy assessment_materials_delete on public.assessment_materials
  for delete to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_materials.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists assessment_questions_write on public.assessment_questions;
create policy assessment_questions_insert on public.assessment_questions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_questions.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy assessment_questions_update on public.assessment_questions
  for update to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_questions.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  )
  with check (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_questions.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy assessment_questions_delete on public.assessment_questions
  for delete to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_questions.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists question_curriculum_nodes_write on public.question_curriculum_nodes;
create policy question_curriculum_nodes_insert on public.question_curriculum_nodes
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.assessment_questions q
      join public.assessments a on a.id = q.assessment_id
      where q.id = question_curriculum_nodes.question_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy question_curriculum_nodes_update on public.question_curriculum_nodes
  for update to authenticated
  using (
    exists (
      select 1
      from public.assessment_questions q
      join public.assessments a on a.id = q.assessment_id
      where q.id = question_curriculum_nodes.question_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  )
  with check (
    exists (
      select 1
      from public.assessment_questions q
      join public.assessments a on a.id = q.assessment_id
      where q.id = question_curriculum_nodes.question_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy question_curriculum_nodes_delete on public.question_curriculum_nodes
  for delete to authenticated
  using (
    exists (
      select 1
      from public.assessment_questions q
      join public.assessments a on a.id = q.assessment_id
      where q.id = question_curriculum_nodes.question_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists student_responses_write on public.student_responses;
create policy student_responses_insert on public.student_responses
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.assessments a
      join public.student_enrollments se on se.class_id = a.class_id
      where a.id = student_responses.assessment_id
        and se.student_id = student_responses.student_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy student_responses_update on public.student_responses
  for update to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = student_responses.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  )
  with check (
    exists (
      select 1
      from public.assessments a
      join public.student_enrollments se on se.class_id = a.class_id
      where a.id = student_responses.assessment_id
        and se.student_id = student_responses.student_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );
create policy student_responses_delete on public.student_responses
  for delete to authenticated
  using (
    exists (
      select 1 from public.assessments a
      where a.id = student_responses.assessment_id
        and (a.teacher_id = (select auth.uid()) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists ai_analysis_runs_write on public.ai_analysis_runs;
create policy ai_analysis_runs_insert on public.ai_analysis_runs
  for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = ai_analysis_runs.assessment_id
        and public.teaches_class(a.class_id)
    )
  );
create policy ai_analysis_runs_update on public.ai_analysis_runs
  for update to authenticated
  using (teacher_id = (select auth.uid()) or public.is_school_admin(school_id))
  with check (teacher_id = (select auth.uid()) or public.is_school_admin(school_id));
create policy ai_analysis_runs_delete on public.ai_analysis_runs
  for delete to authenticated
  using (teacher_id = (select auth.uid()) or public.is_school_admin(school_id));

drop policy if exists error_observations_write on public.error_observations;
create policy error_observations_insert on public.error_observations
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = error_observations.assessment_id
        and public.teaches_class(a.class_id)
    )
  );
create policy error_observations_update on public.error_observations
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_school_admin(school_id))
  with check (created_by = (select auth.uid()) or public.is_school_admin(school_id));
create policy error_observations_delete on public.error_observations
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_school_admin(school_id));

drop policy if exists pedagogical_recommendations_write on public.pedagogical_recommendations;
create policy pedagogical_recommendations_insert on public.pedagogical_recommendations
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = pedagogical_recommendations.assessment_id
        and public.teaches_class(a.class_id)
    )
  );
create policy pedagogical_recommendations_update on public.pedagogical_recommendations
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_school_admin(school_id))
  with check (created_by = (select auth.uid()) or public.is_school_admin(school_id));
create policy pedagogical_recommendations_delete on public.pedagogical_recommendations
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_school_admin(school_id));

create index if not exists idx_curriculum_nodes_source
  on public.curriculum_nodes(source_id);
create index if not exists idx_curriculum_edges_to
  on public.curriculum_edges(to_node_id);
create index if not exists idx_assessment_materials_updated_by
  on public.assessment_materials(updated_by);
create index if not exists idx_question_curriculum_nodes_node
  on public.question_curriculum_nodes(curriculum_node_id);
create index if not exists idx_student_responses_assessment
  on public.student_responses(assessment_id);
create index if not exists idx_ai_analysis_runs_school
  on public.ai_analysis_runs(school_id);
create index if not exists idx_ai_analysis_runs_teacher
  on public.ai_analysis_runs(teacher_id);
create index if not exists idx_ai_analysis_runs_student
  on public.ai_analysis_runs(student_id);
create index if not exists idx_ai_analysis_runs_assessment
  on public.ai_analysis_runs(assessment_id);
create index if not exists idx_error_observations_run
  on public.error_observations(analysis_run_id);
create index if not exists idx_error_observations_assessment
  on public.error_observations(assessment_id);
create index if not exists idx_error_observations_question
  on public.error_observations(question_id);
create index if not exists idx_error_observations_response
  on public.error_observations(student_response_id);
create index if not exists idx_error_observations_school
  on public.error_observations(school_id);
create index if not exists idx_error_observations_created_by
  on public.error_observations(created_by);
create index if not exists idx_pedagogical_recommendations_run
  on public.pedagogical_recommendations(analysis_run_id);
create index if not exists idx_pedagogical_recommendations_school
  on public.pedagogical_recommendations(school_id);
create index if not exists idx_pedagogical_recommendations_assessment
  on public.pedagogical_recommendations(assessment_id);
create index if not exists idx_pedagogical_recommendations_node
  on public.pedagogical_recommendations(curriculum_node_id);
create index if not exists idx_pedagogical_recommendations_created_by
  on public.pedagogical_recommendations(created_by);
