-- Row Level Security — FOCUS
--
-- Principe directeur : chaque table sensible a RLS activé + FORCÉ (force row
-- level security s'applique aussi au propriétaire de la table, pour qu'un
-- bug d'exécution avec un rôle élevé ne contourne pas silencieusement la
-- policy). Aucune policy "true" permissive par défaut : l'absence de policy
-- pour une opération = accès refusé pour cette opération.

-- ---------------------------------------------------------------------------
-- schools
-- ---------------------------------------------------------------------------
alter table schools enable row level security;
alter table schools force row level security;

create policy schools_select on schools for select
  using (is_school_member(id));

create policy schools_update on schools for update
  using (is_school_admin(id)) with check (is_school_admin(id));

-- Pas de policy INSERT ici par choix : la création d'un tout premier
-- établissement (avant qu'un admin n'existe) est un cas de bootstrap géré
-- côté serveur avec la service role key (jamais exposée au navigateur),
-- pas via une policy RLS ouverte à tout utilisateur authentifié.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table profiles force row level security;

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or shares_class_with(id)
    or exists (
      select 1 from school_memberships sm
      where sm.user_id = profiles.id and is_school_admin(sm.school_id)
    )
  );

create policy profiles_insert_own on profiles for insert
  with check (id = auth.uid());

create policy profiles_update_own on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- school_memberships
-- ---------------------------------------------------------------------------
alter table school_memberships enable row level security;
alter table school_memberships force row level security;

create policy memberships_select on school_memberships for select
  using (user_id = auth.uid() or is_school_admin(school_id));

create policy memberships_write on school_memberships for insert
  with check (is_school_admin(school_id));

create policy memberships_update on school_memberships for update
  using (is_school_admin(school_id)) with check (is_school_admin(school_id));

create policy memberships_delete on school_memberships for delete
  using (is_school_admin(school_id));

-- ---------------------------------------------------------------------------
-- academic_years / classes
-- ---------------------------------------------------------------------------
alter table academic_years enable row level security;
alter table academic_years force row level security;

create policy academic_years_select on academic_years for select
  using (is_school_member(school_id));
create policy academic_years_write on academic_years for insert
  with check (is_school_admin(school_id));
create policy academic_years_update on academic_years for update
  using (is_school_admin(school_id)) with check (is_school_admin(school_id));
create policy academic_years_delete on academic_years for delete
  using (is_school_admin(school_id));

alter table classes enable row level security;
alter table classes force row level security;

create policy classes_select on classes for select
  using (is_school_member(school_id));
create policy classes_write on classes for insert
  with check (is_school_admin(school_id));
create policy classes_update on classes for update
  using (is_school_admin(school_id)) with check (is_school_admin(school_id));
create policy classes_delete on classes for delete
  using (is_school_admin(school_id));

-- ---------------------------------------------------------------------------
-- subjects / competencies (school_id nul = ressource globale, lisible par
-- n'importe quel utilisateur authentifié)
-- ---------------------------------------------------------------------------
alter table subjects enable row level security;
alter table subjects force row level security;

create policy subjects_select on subjects for select
  using (can_read_school_scoped(school_id));
create policy subjects_write on subjects for insert
  with check (school_id is not null and is_school_admin(school_id));
create policy subjects_update on subjects for update
  using (school_id is not null and is_school_admin(school_id))
  with check (school_id is not null and is_school_admin(school_id));
create policy subjects_delete on subjects for delete
  using (school_id is not null and is_school_admin(school_id));

alter table competencies enable row level security;
alter table competencies force row level security;

create policy competencies_select on competencies for select
  using (can_read_school_scoped(school_id));
create policy competencies_write on competencies for insert
  with check (school_id is not null and is_school_admin(school_id));
create policy competencies_update on competencies for update
  using (school_id is not null and is_school_admin(school_id))
  with check (school_id is not null and is_school_admin(school_id));
create policy competencies_delete on competencies for delete
  using (school_id is not null and is_school_admin(school_id));

-- ---------------------------------------------------------------------------
-- teacher_assignments / student_enrollments
-- ---------------------------------------------------------------------------
alter table teacher_assignments enable row level security;
alter table teacher_assignments force row level security;

create policy teacher_assignments_select on teacher_assignments for select
  using (teacher_id = auth.uid() or is_school_admin(school_id));
create policy teacher_assignments_write on teacher_assignments for insert
  with check (is_school_admin(school_id));
create policy teacher_assignments_delete on teacher_assignments for delete
  using (is_school_admin(school_id));

alter table student_enrollments enable row level security;
alter table student_enrollments force row level security;

create policy student_enrollments_select on student_enrollments for select
  using (
    student_id = auth.uid()
    or teaches_class(class_id)
    or is_school_admin(school_id)
  );
create policy student_enrollments_write on student_enrollments for insert
  with check (is_school_admin(school_id));
create policy student_enrollments_delete on student_enrollments for delete
  using (is_school_admin(school_id));

-- ---------------------------------------------------------------------------
-- assessments / assessment_competencies / assessment_results / competency_results
-- ---------------------------------------------------------------------------
alter table assessments enable row level security;
alter table assessments force row level security;

create policy assessments_select on assessments for select
  using (
    teaches_class(class_id)
    or enrolled_in_class(class_id)
    or is_school_admin(school_id)
  );
create policy assessments_write on assessments for insert
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from teacher_assignments ta
      where ta.teacher_id = auth.uid()
        and ta.class_id = assessments.class_id
        and ta.subject_id = assessments.subject_id
    )
  );
create policy assessments_update on assessments for update
  using (teacher_id = auth.uid() or is_school_admin(school_id))
  with check (teacher_id = auth.uid() or is_school_admin(school_id));
create policy assessments_delete on assessments for delete
  using (teacher_id = auth.uid() or is_school_admin(school_id));

alter table assessment_competencies enable row level security;
alter table assessment_competencies force row level security;

create policy assessment_competencies_select on assessment_competencies for select
  using (exists (
    select 1 from assessments a
    where a.id = assessment_competencies.assessment_id
      and (teaches_class(a.class_id) or enrolled_in_class(a.class_id) or is_school_admin(a.school_id))
  ));
create policy assessment_competencies_write on assessment_competencies for insert
  with check (exists (
    select 1 from assessments a
    where a.id = assessment_competencies.assessment_id and a.teacher_id = auth.uid()
  ));
create policy assessment_competencies_delete on assessment_competencies for delete
  using (exists (
    select 1 from assessments a
    where a.id = assessment_competencies.assessment_id and a.teacher_id = auth.uid()
  ));

alter table assessment_results enable row level security;
alter table assessment_results force row level security;

create policy assessment_results_select on assessment_results for select
  using (
    student_id = auth.uid()
    or exists (
      select 1 from assessments a
      where a.id = assessment_results.assessment_id
        and (teaches_class(a.class_id) or is_school_admin(a.school_id))
    )
  );
create policy assessment_results_write on assessment_results for insert
  with check (exists (
    select 1 from assessments a
    where a.id = assessment_results.assessment_id and a.teacher_id = auth.uid()
  ));
create policy assessment_results_update on assessment_results for update
  using (exists (
    select 1 from assessments a
    where a.id = assessment_results.assessment_id
      and (a.teacher_id = auth.uid() or is_school_admin(a.school_id))
  ))
  with check (exists (
    select 1 from assessments a
    where a.id = assessment_results.assessment_id
      and (a.teacher_id = auth.uid() or is_school_admin(a.school_id))
  ));
create policy assessment_results_delete on assessment_results for delete
  using (exists (
    select 1 from assessments a
    where a.id = assessment_results.assessment_id
      and (a.teacher_id = auth.uid() or is_school_admin(a.school_id))
  ));

alter table competency_results enable row level security;
alter table competency_results force row level security;

create policy competency_results_select on competency_results for select
  using (exists (
    select 1 from assessment_results ar
    join assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id
      and (ar.student_id = auth.uid() or teaches_class(a.class_id) or is_school_admin(a.school_id))
  ));
create policy competency_results_write on competency_results for insert
  with check (exists (
    select 1 from assessment_results ar
    join assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id and a.teacher_id = auth.uid()
  ));
create policy competency_results_update on competency_results for update
  using (exists (
    select 1 from assessment_results ar
    join assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id
      and (a.teacher_id = auth.uid() or is_school_admin(a.school_id))
  ))
  with check (exists (
    select 1 from assessment_results ar
    join assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id
      and (a.teacher_id = auth.uid() or is_school_admin(a.school_id))
  ));
create policy competency_results_delete on competency_results for delete
  using (exists (
    select 1 from assessment_results ar
    join assessments a on a.id = ar.assessment_id
    where ar.id = competency_results.assessment_result_id
      and (a.teacher_id = auth.uid() or is_school_admin(a.school_id))
  ));

-- ---------------------------------------------------------------------------
-- homework / homework_resources / homework_views
-- ---------------------------------------------------------------------------
alter table homework enable row level security;
alter table homework force row level security;

create policy homework_select on homework for select
  using (teaches_class(class_id) or enrolled_in_class(class_id) or is_school_admin(school_id));
create policy homework_write on homework for insert
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from teacher_assignments ta
      where ta.teacher_id = auth.uid() and ta.class_id = homework.class_id and ta.subject_id = homework.subject_id
    )
  );
create policy homework_update on homework for update
  using (teacher_id = auth.uid() or is_school_admin(school_id))
  with check (teacher_id = auth.uid() or is_school_admin(school_id));
create policy homework_delete on homework for delete
  using (teacher_id = auth.uid() or is_school_admin(school_id));

alter table homework_resources enable row level security;
alter table homework_resources force row level security;

create policy homework_resources_select on homework_resources for select
  using (exists (
    select 1 from homework h where h.id = homework_resources.homework_id
      and (teaches_class(h.class_id) or enrolled_in_class(h.class_id) or is_school_admin(h.school_id))
  ));
create policy homework_resources_write on homework_resources for insert
  with check (exists (
    select 1 from homework h where h.id = homework_resources.homework_id and h.teacher_id = auth.uid()
  ));
create policy homework_resources_delete on homework_resources for delete
  using (exists (
    select 1 from homework h where h.id = homework_resources.homework_id and h.teacher_id = auth.uid()
  ));

alter table homework_views enable row level security;
alter table homework_views force row level security;

create policy homework_views_select on homework_views for select
  using (
    student_id = auth.uid()
    or exists (
      select 1 from homework h where h.id = homework_views.homework_id
        and (teaches_class(h.class_id) or is_school_admin(h.school_id))
    )
  );
create policy homework_views_insert on homework_views for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from homework h where h.id = homework_views.homework_id and enrolled_in_class(h.class_id)
    )
  );

-- ---------------------------------------------------------------------------
-- lessons / lesson_competencies / lesson_absences
-- ---------------------------------------------------------------------------
alter table lessons enable row level security;
alter table lessons force row level security;

create policy lessons_select on lessons for select
  using (teaches_class(class_id) or enrolled_in_class(class_id) or is_school_admin(school_id));
create policy lessons_write on lessons for insert
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from teacher_assignments ta
      where ta.teacher_id = auth.uid() and ta.class_id = lessons.class_id and ta.subject_id = lessons.subject_id
    )
  );
create policy lessons_update on lessons for update
  using (teacher_id = auth.uid() or is_school_admin(school_id))
  with check (teacher_id = auth.uid() or is_school_admin(school_id));
create policy lessons_delete on lessons for delete
  using (teacher_id = auth.uid() or is_school_admin(school_id));

alter table lesson_competencies enable row level security;
alter table lesson_competencies force row level security;

create policy lesson_competencies_select on lesson_competencies for select
  using (exists (
    select 1 from lessons l where l.id = lesson_competencies.lesson_id
      and (teaches_class(l.class_id) or enrolled_in_class(l.class_id) or is_school_admin(l.school_id))
  ));
create policy lesson_competencies_write on lesson_competencies for insert
  with check (exists (
    select 1 from lessons l where l.id = lesson_competencies.lesson_id and l.teacher_id = auth.uid()
  ));
create policy lesson_competencies_delete on lesson_competencies for delete
  using (exists (
    select 1 from lessons l where l.id = lesson_competencies.lesson_id and l.teacher_id = auth.uid()
  ));

alter table lesson_absences enable row level security;
alter table lesson_absences force row level security;

create policy lesson_absences_select on lesson_absences for select
  using (
    student_id = auth.uid()
    or exists (
      select 1 from lessons l where l.id = lesson_absences.lesson_id
        and (teaches_class(l.class_id) or is_school_admin(l.school_id))
    )
  );
create policy lesson_absences_write on lesson_absences for insert
  with check (exists (
    select 1 from lessons l where l.id = lesson_absences.lesson_id and l.teacher_id = auth.uid()
  ));
create policy lesson_absences_update on lesson_absences for update
  using (
    student_id = auth.uid()
    or exists (
      select 1 from lessons l where l.id = lesson_absences.lesson_id
        and (l.teacher_id = auth.uid() or is_school_admin(l.school_id))
    )
  )
  with check (
    student_id = auth.uid()
    or exists (
      select 1 from lessons l where l.id = lesson_absences.lesson_id
        and (l.teacher_id = auth.uid() or is_school_admin(l.school_id))
    )
  );

-- ---------------------------------------------------------------------------
-- learning_paths / learning_activities / student_progress
-- (structure prête pour la future couche IA — pas encore alimentée en V1)
-- ---------------------------------------------------------------------------
alter table learning_paths enable row level security;
alter table learning_paths force row level security;

create policy learning_paths_select on learning_paths for select
  using (student_id = auth.uid() or shares_class_with(student_id) or is_school_admin(school_id));
create policy learning_paths_write on learning_paths for insert
  with check (shares_class_with(student_id) or is_school_admin(school_id));
create policy learning_paths_update on learning_paths for update
  using (student_id = auth.uid() or shares_class_with(student_id) or is_school_admin(school_id))
  with check (student_id = auth.uid() or shares_class_with(student_id) or is_school_admin(school_id));

alter table learning_activities enable row level security;
alter table learning_activities force row level security;

create policy learning_activities_select on learning_activities for select
  using (exists (
    select 1 from learning_paths lp where lp.id = learning_activities.learning_path_id
      and (lp.student_id = auth.uid() or shares_class_with(lp.student_id) or is_school_admin(lp.school_id))
  ));
create policy learning_activities_write on learning_activities for insert
  with check (exists (
    select 1 from learning_paths lp where lp.id = learning_activities.learning_path_id
      and (shares_class_with(lp.student_id) or is_school_admin(lp.school_id))
  ));

alter table student_progress enable row level security;
alter table student_progress force row level security;

create policy student_progress_select on student_progress for select
  using (
    student_id = auth.uid()
    or shares_class_with(student_id)
  );
create policy student_progress_write on student_progress for insert
  with check (student_id = auth.uid());
create policy student_progress_update on student_progress for update
  using (student_id = auth.uid()) with check (student_id = auth.uid());
