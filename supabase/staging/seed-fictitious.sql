-- STAGING ONLY — fictitious school for the isolation checks and the Preview
-- walkthrough. Never run on the live project.
--
-- Before running: create two users in Authentication → Users (email +
-- password, "auto confirm"): teacher-a@example.test and teacher-b@example.test.
-- This script then gives them the teacher role in app_metadata (never
-- user_metadata), one class each, and fictitious students without login.
-- Idempotent: it does nothing if the school already exists.

do $$
declare
  v_a uuid := (select id from auth.users where email = 'teacher-a@example.test');
  v_b uuid := (select id from auth.users where email = 'teacher-b@example.test');
  v_school uuid;
  v_year uuid;
  v_class_a uuid;
  v_class_b uuid;
  v_subject uuid;
  v_student uuid;
  v_name text;
  v_index integer := 0;
begin
  if v_a is null or v_b is null then
    raise exception 'create teacher-a@example.test and teacher-b@example.test in Authentication first';
  end if;
  if exists (select 1 from public.schools where name = 'Lycée de recette FOCUS (fictif)') then
    raise notice 'fictitious school already present';
    return;
  end if;

  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"teacher"}'::jsonb
  where id in (v_a, v_b);

  insert into public.schools(name) values ('Lycée de recette FOCUS (fictif)') returning id into v_school;
  insert into public.academic_years(school_id, name, starts_at, ends_at, active)
  values (v_school, '2026-2027', '2026-09-01', '2027-07-04', true) returning id into v_year;
  insert into public.classes(school_id, academic_year_id, name, level) values (v_school, v_year, 'Seconde A (fictive)', 'Seconde') returning id into v_class_a;
  insert into public.classes(school_id, academic_year_id, name, level) values (v_school, v_year, 'Seconde B (fictive)', 'Seconde') returning id into v_class_b;
  insert into public.subjects(school_id, name, code) values (v_school, 'Mathématiques', 'MATH') returning id into v_subject;

  insert into public.profiles(id, first_name, last_name) values (v_a, 'Alice', 'Recette'), (v_b, 'Bruno', 'Recette')
  on conflict (id) do nothing;
  insert into public.school_memberships(school_id, user_id, role) values (v_school, v_a, 'teacher'), (v_school, v_b, 'teacher');
  insert into public.teacher_assignments(school_id, teacher_id, class_id, subject_id)
  values (v_school, v_a, v_class_a, v_subject), (v_school, v_b, v_class_b, v_subject);

  foreach v_name in array array['Ana Lefort', 'Bilal Roux', 'Chloé Marin', 'Diego Sanz', 'Emma Petit', 'Farid Nour'] loop
    v_index := v_index + 1;
    insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'eleve' || v_index || '.recette@example.test', '{}'::jsonb, '{}'::jsonb, now(), now())
    returning id into v_student;
    insert into public.profiles(id, first_name, last_name) values (v_student, split_part(v_name, ' ', 1), split_part(v_name, ' ', 2))
    on conflict (id) do nothing;
    insert into public.school_memberships(school_id, user_id, role) values (v_school, v_student, 'student');
    insert into public.student_enrollments(school_id, student_id, class_id, academic_year_id)
    values (v_school, v_student, case when v_index <= 3 then v_class_a else v_class_b end, v_year);
  end loop;
  raise notice 'fictitious staging school created';
end;
$$;
