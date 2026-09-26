-- FOCUS pedagogical AI V1 — mathematics, lycée 2026-2027
-- Official source: BO n°14 du 2 avril 2026, NOR MENE2602914A.
-- The curriculum seed stores short labels and source locators, not copied course content.

create table if not exists public.curriculum_sources (
  id uuid primary key default gen_random_uuid(),
  subject_code text not null,
  level_code text not null,
  school_year text not null,
  title text not null,
  publisher text not null,
  official_reference text not null,
  source_url text not null unique,
  published_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_nodes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.curriculum_sources(id) on delete restrict,
  code text not null unique,
  node_type text not null check (node_type in ('domain','notion','competency','prerequisite')),
  title text not null,
  description text,
  source_locator text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.curriculum_edges (
  from_node_id uuid not null references public.curriculum_nodes(id) on delete cascade,
  to_node_id uuid not null references public.curriculum_nodes(id) on delete cascade,
  relation text not null check (relation in ('prerequisite_of','supports','part_of')),
  created_at timestamptz not null default now(),
  primary key (from_node_id, to_node_id, relation),
  check (from_node_id <> to_node_id)
);

create table if not exists public.assessment_materials (
  assessment_id uuid primary key references public.assessments(id) on delete cascade,
  context_text text,
  instructions_text text,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  position integer not null check (position > 0),
  prompt text not null,
  correction_text text not null,
  rubric jsonb not null default '{}'::jsonb,
  max_points numeric check (max_points is null or max_points > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, position)
);

create table if not exists public.question_curriculum_nodes (
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  curriculum_node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  relation text not null check (relation in ('assesses','prerequisite')),
  created_at timestamptz not null default now(),
  primary key (question_id, curriculum_node_id, relation)
);

create table if not exists public.student_responses (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  response_text text not null,
  awarded_points numeric check (awarded_points is null or awarded_points >= 0),
  teacher_annotation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, student_id)
);

create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete cascade,
  model text not null,
  input_hash text not null,
  status text not null check (status in ('completed','failed','no_evidence')),
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.error_observations (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.ai_analysis_runs(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  student_response_id uuid not null references public.student_responses(id) on delete cascade,
  curriculum_node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  error_type text not null,
  evidence_excerpt text not null,
  explanation text not null,
  confidence text not null check (confidence in ('limitee','moderee','forte')),
  source text not null check (source in ('ai','teacher')),
  created_by uuid not null references auth.users(id) on delete restrict,
  verified_by_teacher boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.pedagogical_recommendations (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.ai_analysis_runs(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  curriculum_node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  difficulty text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('limitee','moderee','forte')),
  explanation text not null,
  recommended_action text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  teacher_validated boolean not null default false,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_assessment_questions_assessment
  on public.assessment_questions(assessment_id);
create index if not exists idx_student_responses_student_assessment
  on public.student_responses(student_id, assessment_id);
create index if not exists idx_error_observations_student
  on public.error_observations(student_id, created_at desc);
create index if not exists idx_error_observations_node
  on public.error_observations(curriculum_node_id, student_id);
create index if not exists idx_pedagogical_recommendations_student
  on public.pedagogical_recommendations(student_id, created_at desc);

alter table public.curriculum_sources enable row level security;
alter table public.curriculum_nodes enable row level security;
alter table public.curriculum_edges enable row level security;
alter table public.assessment_materials enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.question_curriculum_nodes enable row level security;
alter table public.student_responses enable row level security;
alter table public.ai_analysis_runs enable row level security;
alter table public.error_observations enable row level security;
alter table public.pedagogical_recommendations enable row level security;

drop policy if exists curriculum_sources_select on public.curriculum_sources;
create policy curriculum_sources_select on public.curriculum_sources
  for select to authenticated using (true);

drop policy if exists curriculum_nodes_select on public.curriculum_nodes;
create policy curriculum_nodes_select on public.curriculum_nodes
  for select to authenticated using (true);

drop policy if exists curriculum_edges_select on public.curriculum_edges;
create policy curriculum_edges_select on public.curriculum_edges
  for select to authenticated using (true);

drop policy if exists assessment_materials_select on public.assessment_materials;
create policy assessment_materials_select on public.assessment_materials
  for select to authenticated using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_materials.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists assessment_materials_write on public.assessment_materials;
create policy assessment_materials_write on public.assessment_materials
  for all to authenticated
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

drop policy if exists assessment_questions_select on public.assessment_questions;
create policy assessment_questions_select on public.assessment_questions
  for select to authenticated using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_questions.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists assessment_questions_write on public.assessment_questions;
create policy assessment_questions_write on public.assessment_questions
  for all to authenticated
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

drop policy if exists question_curriculum_nodes_select on public.question_curriculum_nodes;
create policy question_curriculum_nodes_select on public.question_curriculum_nodes
  for select to authenticated using (
    exists (
      select 1
      from public.assessment_questions q
      join public.assessments a on a.id = q.assessment_id
      where q.id = question_curriculum_nodes.question_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists question_curriculum_nodes_write on public.question_curriculum_nodes;
create policy question_curriculum_nodes_write on public.question_curriculum_nodes
  for all to authenticated
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

drop policy if exists student_responses_select on public.student_responses;
create policy student_responses_select on public.student_responses
  for select to authenticated using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.assessments a
      where a.id = student_responses.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists student_responses_write on public.student_responses;
create policy student_responses_write on public.student_responses
  for all to authenticated
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

drop policy if exists ai_analysis_runs_select on public.ai_analysis_runs;
create policy ai_analysis_runs_select on public.ai_analysis_runs
  for select to authenticated using (
    teacher_id = (select auth.uid()) or public.is_school_admin(school_id)
  );

drop policy if exists ai_analysis_runs_write on public.ai_analysis_runs;
create policy ai_analysis_runs_write on public.ai_analysis_runs
  for all to authenticated
  using (
    teacher_id = (select auth.uid()) or public.is_school_admin(school_id)
  )
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = ai_analysis_runs.assessment_id
        and public.teaches_class(a.class_id)
    )
  );

drop policy if exists error_observations_select on public.error_observations;
create policy error_observations_select on public.error_observations
  for select to authenticated using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.assessments a
      where a.id = error_observations.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists error_observations_write on public.error_observations;
create policy error_observations_write on public.error_observations
  for all to authenticated
  using (
    created_by = (select auth.uid()) or public.is_school_admin(school_id)
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = error_observations.assessment_id
        and public.teaches_class(a.class_id)
    )
  );

drop policy if exists pedagogical_recommendations_select on public.pedagogical_recommendations;
create policy pedagogical_recommendations_select on public.pedagogical_recommendations
  for select to authenticated using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.assessments a
      where a.id = pedagogical_recommendations.assessment_id
        and (public.teaches_class(a.class_id) or public.is_school_admin(a.school_id))
    )
  );

drop policy if exists pedagogical_recommendations_write on public.pedagogical_recommendations;
create policy pedagogical_recommendations_write on public.pedagogical_recommendations
  for all to authenticated
  using (
    created_by = (select auth.uid()) or public.is_school_admin(school_id)
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.assessments a
      where a.id = pedagogical_recommendations.assessment_id
        and public.teaches_class(a.class_id)
    )
  );

grant select on public.curriculum_sources, public.curriculum_nodes, public.curriculum_edges to authenticated;
grant select, insert, update, delete on public.assessment_materials, public.assessment_questions,
  public.question_curriculum_nodes, public.student_responses, public.ai_analysis_runs,
  public.error_observations, public.pedagogical_recommendations to authenticated;

insert into public.curriculum_sources (
  subject_code, level_code, school_year, title, publisher,
  official_reference, source_url, published_on
) values (
  'MATH', 'SECONDE_GT', '2026-2027',
  'Programme d’enseignement de mathématiques de la classe de seconde générale et technologique',
  'Ministère de l’Éducation nationale',
  'BO n°14 du 2 avril 2026 — NOR MENE2602914A',
  'https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A',
  '2026-04-02'
)
on conflict (source_url) do update set
  school_year = excluded.school_year,
  title = excluded.title,
  official_reference = excluded.official_reference;

with src as (
  select id from public.curriculum_sources
  where source_url = 'https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A'
), seed(code,node_type,title,description,source_locator) as (
  values
  ('MATH.COMP.CHERCHER','competency','Chercher, expérimenter','Mettre en œuvre une recherche ou une expérimentation mathématique.','Préambule — compétences mathématiques, p. 1'),
  ('MATH.COMP.MODELISER','competency','Modéliser','Construire, simuler, valider ou invalider un modèle.','Préambule — compétences mathématiques, p. 1'),
  ('MATH.COMP.REPRESENTER','competency','Représenter','Choisir et relier des registres numériques, algébriques et géométriques.','Préambule — compétences mathématiques, p. 1'),
  ('MATH.COMP.RAISONNER','competency','Raisonner','Démontrer, organiser et mettre en perspective des résultats.','Préambule — compétences mathématiques, p. 1'),
  ('MATH.COMP.CALCULER','competency','Calculer','Appliquer des techniques et mettre en œuvre des algorithmes.','Préambule — compétences mathématiques, p. 1'),
  ('MATH.COMP.COMMUNIQUER','competency','Communiquer','Expliquer une démarche et présenter un résultat.','Préambule — compétences mathématiques, p. 1'),
  ('MATH.NUM.ARITHMETIQUE','notion','Multiples, diviseurs et fractions irréductibles','Arithmétique de base mobilisée dans des problèmes et simplifications.','Nombres et calculs — arithmétique, p. 7'),
  ('MATH.NUM.INTERVALLES','notion','Intervalles de nombres réels','Lire, représenter et utiliser les intervalles de la droite réelle.','Nombres réels, p. 7'),
  ('MATH.NUM.VALEUR_ABSOLUE','notion','Valeur absolue comme distance','Utiliser la valeur absolue pour exprimer une distance et certains intervalles.','Nombres réels, p. 7'),
  ('MATH.ALG.EXPRESSIONS','notion','Calcul littéral : développer, factoriser, réduire','Manipuler des expressions algébriques simples avec justification.','Automatismes / algèbre, p. 5-7'),
  ('MATH.ALG.EQUATIONS','notion','Équations et inéquations du premier degré','Résoudre et interpréter des équations ou inéquations se ramenant au premier degré.','Nombres et calculs — algèbre, p. 6-7'),
  ('MATH.GEO.VECTEURS','notion','Vecteurs du plan','Utiliser coordonnées, colinéarité et calcul vectoriel pour résoudre des problèmes.','Géométrie — vecteurs, p. 8-9'),
  ('MATH.GEO.DROITES','notion','Droites du plan','Relier vecteur directeur, pente et équations de droite.','Géométrie — droites du plan, p. 9'),
  ('MATH.FONC.REPRESENTATIONS','notion','Représentations d’une fonction','Passer entre expression, tableau, courbe et domaine de définition.','Fonctions — représentations, p. 10'),
  ('MATH.FONC.SIGNES','notion','Signe d’une fonction','Étudier le signe d’une fonction affine, d’un produit ou d’un quotient.','Fonctions — représentations, p. 10'),
  ('MATH.FONC.VARIATIONS','notion','Variations et extrémums','Lire, décrire et exploiter les variations d’une fonction.','Fonctions — variations et extrémums, p. 11'),
  ('MATH.STAT.PROPORTIONS','notion','Proportions et évolutions','Distinguer proportions, évolutions, coefficients multiplicateurs et évolutions successives.','Statistiques — information chiffrée, p. 11-12'),
  ('MATH.STAT.DESCRIPTIVE','notion','Statistique descriptive','Interpréter les indicateurs d’une série et la dispersion.','Statistiques descriptives, p. 11-12'),
  ('MATH.STAT.FREQUENCE_CONDITIONNELLE','notion','Fréquence conditionnelle','Lire et interpréter des fréquences conditionnelles dans des tableaux croisés.','Croisement de variables qualitatives, p. 12'),
  ('MATH.PROBA.CONDITIONNELLE','notion','Probabilité conditionnelle','Distinguer et calculer des probabilités conditionnelles dans une situation donnée.','Probabilités, p. 13'),
  ('MATH.PROBA.ARBRES','notion','Arbres de probabilité','Construire et interpréter un arbre pondéré.','Probabilités, p. 13')
)
insert into public.curriculum_nodes(source_id, code, node_type, title, description, source_locator)
select src.id, seed.code, seed.node_type, seed.title, seed.description, seed.source_locator
from src cross join seed
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  source_locator = excluded.source_locator,
  active = true;

with edge_codes(from_code,to_code,relation) as (
  values
  ('MATH.NUM.INTERVALLES','MATH.NUM.VALEUR_ABSOLUE','prerequisite_of'),
  ('MATH.ALG.EXPRESSIONS','MATH.ALG.EQUATIONS','prerequisite_of'),
  ('MATH.GEO.VECTEURS','MATH.GEO.DROITES','prerequisite_of'),
  ('MATH.FONC.REPRESENTATIONS','MATH.FONC.SIGNES','prerequisite_of'),
  ('MATH.FONC.REPRESENTATIONS','MATH.FONC.VARIATIONS','prerequisite_of'),
  ('MATH.STAT.PROPORTIONS','MATH.STAT.FREQUENCE_CONDITIONNELLE','prerequisite_of'),
  ('MATH.STAT.FREQUENCE_CONDITIONNELLE','MATH.PROBA.CONDITIONNELLE','prerequisite_of'),
  ('MATH.PROBA.CONDITIONNELLE','MATH.PROBA.ARBRES','prerequisite_of'),
  ('MATH.ALG.EXPRESSIONS','MATH.COMP.CALCULER','supports'),
  ('MATH.ALG.EQUATIONS','MATH.COMP.RAISONNER','supports'),
  ('MATH.GEO.VECTEURS','MATH.COMP.REPRESENTER','supports'),
  ('MATH.GEO.DROITES','MATH.COMP.MODELISER','supports'),
  ('MATH.FONC.REPRESENTATIONS','MATH.COMP.REPRESENTER','supports'),
  ('MATH.FONC.SIGNES','MATH.COMP.RAISONNER','supports'),
  ('MATH.FONC.VARIATIONS','MATH.COMP.COMMUNIQUER','supports'),
  ('MATH.STAT.PROPORTIONS','MATH.COMP.MODELISER','supports'),
  ('MATH.STAT.DESCRIPTIVE','MATH.COMP.COMMUNIQUER','supports'),
  ('MATH.PROBA.CONDITIONNELLE','MATH.COMP.RAISONNER','supports'),
  ('MATH.PROBA.ARBRES','MATH.COMP.REPRESENTER','supports')
)
insert into public.curriculum_edges(from_node_id,to_node_id,relation)
select f.id, t.id, edge_codes.relation
from edge_codes
join public.curriculum_nodes f on f.code=edge_codes.from_code
join public.curriculum_nodes t on t.code=edge_codes.to_code
on conflict do nothing;

create or replace function public.focus_save_pedagogical_evidence(
  p_assessment_id uuid,
  p_student_id uuid,
  p_context_text text,
  p_instructions_text text,
  p_questions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assessment public.assessments%rowtype;
  v_question jsonb;
  v_question_id uuid;
  v_position integer;
  v_max_points numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_assessment
  from public.assessments
  where id = p_assessment_id;

  if not found or not (
    v_assessment.teacher_id = (select auth.uid())
    or public.is_school_admin(v_assessment.school_id)
  ) then
    raise exception 'assessment not writable' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.student_enrollments se
    where se.student_id = p_student_id
      and se.class_id = v_assessment.class_id
  ) then
    raise exception 'student not enrolled in assessment class' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_questions, '[]'::jsonb)) <> 'array' then
    raise exception 'questions must be an array' using errcode = '22023';
  end if;

  insert into public.assessment_materials(assessment_id, context_text, instructions_text, updated_by)
  values (p_assessment_id, nullif(btrim(p_context_text), ''), nullif(btrim(p_instructions_text), ''), (select auth.uid()))
  on conflict (assessment_id) do update set
    context_text = excluded.context_text,
    instructions_text = excluded.instructions_text,
    updated_by = excluded.updated_by,
    updated_at = now();

  for v_question in select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb))
  loop
    v_question_id := coalesce(nullif(v_question->>'id','')::uuid, gen_random_uuid());
    v_position := (v_question->>'position')::integer;
    v_max_points := nullif(v_question->>'maxPoints','')::numeric;

    if v_position is null or v_position <= 0
       or nullif(btrim(v_question->>'prompt'),'') is null
       or nullif(btrim(v_question->>'correctionText'),'') is null then
      raise exception 'invalid question payload' using errcode = '22023';
    end if;

    insert into public.assessment_questions(
      id, assessment_id, position, prompt, correction_text, rubric, max_points
    ) values (
      v_question_id,
      p_assessment_id,
      v_position,
      btrim(v_question->>'prompt'),
      btrim(v_question->>'correctionText'),
      jsonb_build_object('text', coalesce(v_question->>'rubricText','')),
      v_max_points
    )
    on conflict (id) do update set
      position = excluded.position,
      prompt = excluded.prompt,
      correction_text = excluded.correction_text,
      rubric = excluded.rubric,
      max_points = excluded.max_points,
      updated_at = now();

    if nullif(btrim(coalesce(v_question->>'responseText','')), '') is not null then
      insert into public.student_responses(
        assessment_id, question_id, student_id, response_text, awarded_points, teacher_annotation
      ) values (
        p_assessment_id,
        v_question_id,
        p_student_id,
        btrim(v_question->>'responseText'),
        nullif(v_question->>'awardedPoints','')::numeric,
        nullif(btrim(coalesce(v_question->>'teacherAnnotation','')), '')
      )
      on conflict (question_id, student_id) do update set
        response_text = excluded.response_text,
        awarded_points = excluded.awarded_points,
        teacher_annotation = excluded.teacher_annotation,
        updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.focus_save_pedagogical_evidence(uuid,uuid,text,text,jsonb) from public;
revoke all on function public.focus_save_pedagogical_evidence(uuid,uuid,text,text,jsonb) from anon;
grant execute on function public.focus_save_pedagogical_evidence(uuid,uuid,text,text,jsonb) to authenticated;
