-- FOCUS RLS probe — run on a real FOCUS database (live or staging) to see
-- what each kind of account can read and write through PostgREST.
--
-- It never leaves anything behind: everything runs inside one DO block that
-- ends with an exception, so every row it creates (a test assessment, a copy,
-- an analysis, a physics teacher, a second school) is rolled back. The result
-- is the JSON in the error message "FOCUS_RLS_PROBE {...}".
--
-- Each identity is simulated exactly as PostgREST does it: `set local role
-- authenticated` (or anon) and the JWT claims in request.jwt.claims.
-- Requires: the fictitious Seconde 3 school of the live project, one teacher
-- assigned to it for mathematics (first by id), two enrolled students, the
-- Physique-Chimie subject and the curriculum node MATH.ALG.DISTRIBUTIVITE.

do $$
declare
  r jsonb := '{}';
  t uuid;
  school_a uuid;
  class_a uuid;
  math_a uuid;
  pc_a uuid;
  s1 uuid;
  s2 uuid;
  p uuid := gen_random_uuid();
  tb uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  school_b uuid;
  year_b uuid;
  class_b uuid;
  math_b uuid;
  a1 uuid := gen_random_uuid();
  q1 uuid;
  resp1 uuid;
  run1 uuid;
  rec1 uuid;
  node uuid;
  n bigint;
  msg text;
begin
  -- ---------------------------------------------------------------- fixtures
  select ta.teacher_id, ta.school_id, ta.class_id, ta.subject_id into t, school_a, class_a, math_a
  from public.teacher_assignments ta
  join public.subjects s on s.id = ta.subject_id
  join auth.users u on u.id = ta.teacher_id
  where s.code = 'MATH' and u.raw_app_meta_data->>'role' = 'teacher'
  order by ta.teacher_id limit 1;
  select id into pc_a from public.subjects where school_id = school_a and code = 'PC';
  select student_id into s1 from public.student_enrollments where class_id = class_a order by student_id limit 1;
  select student_id into s2 from public.student_enrollments where class_id = class_a order by student_id offset 1 limit 1;
  select id into node from public.curriculum_nodes where code = 'MATH.ALG.DISTRIBUTIVITE';

  insert into auth.users(id, email, raw_app_meta_data) values (p, 'rls-probe-pc@example.invalid', '{"role":"teacher"}');
  insert into public.school_memberships(school_id, user_id, role) values (school_a, p, 'teacher');
  insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values (school_a, p, class_a, pc_a);

  insert into public.schools(name) values ('RLS probe — école B') returning id into school_b;
  insert into public.academic_years(school_id, name, starts_at, ends_at, active)
    values (school_b, '2026-2027', '2026-09-01', '2027-07-04', true) returning id into year_b;
  insert into public.classes(school_id, academic_year_id, name, level) values (school_b, year_b, '2nde B', 'Seconde') returning id into class_b;
  insert into public.subjects(school_id, name, code) values (school_b, 'Mathématiques', 'MATH') returning id into math_b;
  insert into auth.users(id, email, raw_app_meta_data) values (tb, 'rls-probe-b@example.invalid', '{"role":"teacher"}'), (sb, null, '{}');
  insert into public.school_memberships(school_id, user_id, role) values (school_b, tb, 'teacher'), (school_b, sb, 'student');
  insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id) values (school_b, tb, class_b, math_b);
  insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id) values (school_b, sb, class_b, year_b);

  -- The maths teacher builds an assessment, a copy, an analysis, a decision.
  perform set_config('request.jwt.claim.sub', t::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.focus_save_assessment(a1, 'RLS probe', current_date, class_a, math_a, '{}'::uuid[], '[]'::jsonb, false);
  select (public.focus_save_assessment_questions(a1, '', '', jsonb_build_array(jsonb_build_object(
    'prompt', 'Développer 3(x+2).', 'correctionText', '3x+6', 'maxPoints', '2', 'nodeCodes', jsonb_build_array('MATH.ALG.DISTRIBUTIVITE'))))->'questionIds'->>0)::uuid
    into q1;
  perform public.focus_save_student_responses(a1, s1, jsonb_build_array(jsonb_build_object(
    'questionId', q1, 'responseText', '3(x+2) = 3x+2', 'awardedPoints', '1', 'teacherAnnotation', 'Revoir la distributivité')));
  select id into resp1 from public.student_responses where question_id = q1 and student_id = s1;
  -- The analysis itself is recorded as the administrator running the probe
  -- (still as the maths teacher, auth.uid() = t): since 20261004090000 the
  -- API roles reach it only through an engine-signed envelope.
  execute 'reset role';
  run1 := public.focus_persist_pedagogical_analysis(school_a, s1, a1, 'rls-probe', repeat('a', 64),
    jsonb_build_array(jsonb_build_object('questionId', q1, 'responseId', resp1, 'nodeId', node, 'errorType', 'calcul',
      'evidenceExcerpt', '3x+2', 'explanation', 'Le 3 n’est appliqué qu’au premier terme.')),
    jsonb_build_array(jsonb_build_object('nodeId', node, 'difficulty', 'Distribuer', 'explanation', 'Explication', 'recommendedAction', 'Action')),
    jsonb_build_array(jsonb_build_object('questionId', q1, 'outcome', 'error', 'excerpt', '3x+2', 'note', '')));
  execute 'set local role authenticated';
  select id into rec1 from public.pedagogical_recommendations where analysis_run_id = run1;
  perform public.focus_review_pedagogical_recommendation(rec1, 'validate', 'Note privée du professeur');
  execute 'reset role';

  -- ------------------------------------------------------------ student s1
  perform set_config('request.jwt.claim.sub', s1::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('student', jsonb_build_object(
    'reads_own_hypotheses', (select count(*) from public.pedagogical_recommendations where student_id = s1),
    'reads_teacher_note', (select count(*) from public.pedagogical_recommendations where student_id = s1 and teacher_note is not null),
    'reads_own_observations', (select count(*) from public.error_observations where student_id = s1),
    'reads_runs', (select count(*) from public.ai_analysis_runs where student_id = s1),
    'reads_review_history', (select count(*) from public.pedagogical_review_events where student_id = s1),
    'reads_own_copy', (select count(*) from public.student_responses where student_id = s1),
    'reads_other_student_copy', (select count(*) from public.student_responses where student_id <> s1),
    'reads_questions_and_correction', (select count(*) from public.assessment_questions where assessment_id = a1)));
  begin
    insert into public.pedagogical_recommendations(analysis_run_id, school_id, student_id, assessment_id, curriculum_node_id, difficulty, confidence, explanation, recommended_action, created_by)
      values (run1, school_a, s1, a1, node, 'x', 'forte', 'x', 'x', s1);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{student,insert_hypothesis}', to_jsonb(msg));
  begin
    update public.student_responses set response_text = '3x+6' where id = resp1;
    get diagnostics n = row_count;
    msg := case when n > 0 then 'ALLOWED' else 'no row visible to update' end;
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{student,edit_own_copy}', to_jsonb(msg));
  begin
    perform public.focus_review_pedagogical_recommendation(rec1, 'dismiss', null);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{student,decide_hypothesis}', to_jsonb(msg));
  begin
    insert into public.learning_paths(school_id, student_id, origin) values (school_b, t, 'competency_gap');
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{student,create_learning_path_for_teacher}', to_jsonb(msg));
  execute 'reset role';

  -- ------------------------------------------- physics teacher of the class
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('other_subject_teacher', jsonb_build_object(
    'reads_maths_assessment', (select count(*) from public.assessments where id = a1),
    'reads_maths_copy', (select count(*) from public.student_responses where assessment_id = a1),
    'reads_hypotheses', (select count(*) from public.pedagogical_recommendations where assessment_id = a1),
    'reads_teacher_note', (select count(*) from public.pedagogical_recommendations where assessment_id = a1 and teacher_note is not null),
    'reads_observations', (select count(*) from public.error_observations where assessment_id = a1),
    'reads_review_history', (select count(*) from public.pedagogical_review_events where recommendation_id = rec1),
    'reads_runs', (select count(*) from public.ai_analysis_runs where assessment_id = a1)));
  begin
    perform public.focus_review_pedagogical_recommendation(rec1, 'dismiss', null);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{other_subject_teacher,decide_hypothesis}', to_jsonb(msg));
  begin
    perform public.focus_persist_no_evidence(school_a, s1, a1, 'm', repeat('b', 64), 'r', '[]'::jsonb);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{other_subject_teacher,record_analysis}', to_jsonb(msg));
  execute 'reset role';

  -- ---------------------------------------------- teacher of another school
  perform set_config('request.jwt.claim.sub', tb::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tb, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('other_school_teacher', jsonb_build_object(
    'reads_school_a_assessments', (select count(*) from public.assessments where school_id = school_a),
    'reads_school_a_students', (select count(*) from public.student_enrollments where school_id = school_a),
    'reads_school_a_profiles', (select count(*) from public.profiles where id = s1),
    'reads_school_a_results', (select count(*) from public.assessment_results r2 join public.assessments a on a.id = r2.assessment_id where a.school_id = school_a),
    'reads_school_a_copies', (select count(*) from public.student_responses where assessment_id = a1),
    'reads_school_a_hypotheses', (select count(*) from public.pedagogical_recommendations where school_id = school_a),
    'reads_school_a_classes', (select count(*) from public.classes where school_id = school_a)));
  begin
    perform public.focus_save_student_responses(a1, s1, jsonb_build_array(jsonb_build_object('questionId', q1, 'responseText', 'x')));
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{other_school_teacher,write_school_a_copy}', to_jsonb(msg));
  begin
    perform public.focus_save_assessment(gen_random_uuid(), 'Intrus', current_date, class_a, math_a, '{}'::uuid[], '[]'::jsonb, false);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{other_school_teacher,create_assessment_in_school_a}', to_jsonb(msg));
  execute 'reset role';

  -- ------------------------------------------- the maths teacher, directly
  perform set_config('request.jwt.claim.sub', t::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || jsonb_build_object('maths_teacher', jsonb_build_object(
    'reads_own_hypotheses', (select count(*) from public.pedagogical_recommendations where assessment_id = a1),
    'reads_school_b_class_students', (select count(*) from public.student_enrollments where class_id = class_b)));
  begin
    insert into public.pedagogical_recommendations(analysis_run_id, school_id, student_id, assessment_id, curriculum_node_id, difficulty, confidence, explanation, recommended_action, created_by)
      values (run1, school_a, s1, a1, node, 'x', 'forte', 'x', 'x', t);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,insert_ai_output_directly}', to_jsonb(msg));
  begin
    update public.error_observations set confidence = 'forte' where analysis_run_id = run1;
    get diagnostics n = row_count;
    msg := case when n > 0 then 'ALLOWED' else 'no row updated' end;
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,raise_confidence_directly}', to_jsonb(msg));
  begin
    update public.assessments set class_id = class_b, school_id = school_b, subject_id = math_b where id = a1;
    get diagnostics n = row_count;
    msg := case when n > 0 then 'ALLOWED' else 'no row updated' end;
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,move_assessment_to_school_b}', to_jsonb(msg));
  begin
    insert into public.assessment_results(assessment_id, student_id, score) values (a1, sb, 12);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,grade_school_b_student}', to_jsonb(msg));
  begin
    update public.assessment_questions set max_points = 0.5 where id = q1;
    get diagnostics n = row_count;
    msg := case when n > 0 then 'ALLOWED' else 'no row updated' end;
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,max_below_awarded_points}', to_jsonb(msg));
  begin
    perform public.focus_save_student_responses(a1, sb, jsonb_build_array(jsonb_build_object('questionId', q1, 'responseText', 'x')));
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,copy_for_student_of_other_class}', to_jsonb(msg));
  -- An "analysis" written by the teacher, not by the FOCUS engine.
  begin
    perform public.focus_persist_pedagogical_analysis(school_a, s1, a1, 'gpt-forged', repeat('c', 64), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,record_forged_analysis}', to_jsonb(msg));
  begin
    perform public.focus_record_engine_analysis(
      jsonb_build_object('v', 1, 'kind', 'no_evidence', 'teacherId', t, 'schoolId', school_a, 'studentId', s1, 'assessmentId', a1,
        'model', 'gpt-forged', 'inputHash', repeat('c', 64), 'evidenceVersion', repeat('0', 32), 'issuedAt', now(), 'reason', 'r')::text,
      repeat('0', 64));
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,record_unsigned_envelope}', to_jsonb(msg));
  begin
    delete from public.assessments where id = a1;
    get diagnostics n = row_count;
    msg := case when n > 0 then 'ALLOWED' else 'no row deleted' end;
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{maths_teacher,delete_analysed_assessment}', to_jsonb(msg));
  execute 'reset role';

  -- ------------------------------------------------------------------ anon
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.student_responses;
    msg := 'ALLOWED (' || n || ' rows)';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := r || jsonb_build_object('anon', jsonb_build_object('read_copies', msg));
  begin
    perform public.focus_teacher_work_queue();
    msg := 'ALLOWED';
  exception when others then msg := 'refused: ' || sqlerrm; end;
  r := jsonb_set(r, '{anon,call_work_queue}', to_jsonb(msg));
  execute 'reset role';

  r := r || jsonb_build_object('schema_version', public.focus_schema_version());
  raise exception 'FOCUS_RLS_PROBE %', r;
end;
$$;
