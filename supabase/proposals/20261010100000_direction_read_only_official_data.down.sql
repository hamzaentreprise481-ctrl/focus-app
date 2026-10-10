-- Rollback of the Direction read-only PROPOSAL: drops its restrictive
-- policies; the permissive policies of the base schema are untouched.
drop policy if exists assessments_owner_update on public.assessments;
drop policy if exists assessments_owner_delete on public.assessments;
drop policy if exists assessment_results_owner_insert on public.assessment_results;
drop policy if exists assessment_results_owner_update on public.assessment_results;
drop policy if exists assessment_results_owner_delete on public.assessment_results;
drop policy if exists competency_results_owner_insert on public.competency_results;
drop policy if exists competency_results_owner_update on public.competency_results;
drop policy if exists competency_results_owner_delete on public.competency_results;
drop policy if exists student_responses_owner_insert on public.student_responses;
drop policy if exists student_responses_owner_update on public.student_responses;
drop policy if exists student_responses_owner_delete on public.student_responses;
drop policy if exists assessment_questions_owner_insert on public.assessment_questions;
drop policy if exists assessment_questions_owner_update on public.assessment_questions;
drop policy if exists assessment_questions_owner_delete on public.assessment_questions;
drop policy if exists assessment_materials_owner_insert on public.assessment_materials;
drop policy if exists assessment_materials_owner_update on public.assessment_materials;
drop policy if exists assessment_materials_owner_delete on public.assessment_materials;
drop policy if exists question_curriculum_nodes_owner_insert on public.question_curriculum_nodes;
drop policy if exists question_curriculum_nodes_owner_update on public.question_curriculum_nodes;
drop policy if exists question_curriculum_nodes_owner_delete on public.question_curriculum_nodes;
drop policy if exists school_memberships_not_self_insert on public.school_memberships;
drop policy if exists school_memberships_not_self_update on public.school_memberships;
drop policy if exists school_memberships_not_self_delete on public.school_memberships;
drop policy if exists teacher_assignments_not_self_insert on public.teacher_assignments;
drop policy if exists teacher_assignments_not_self_update on public.teacher_assignments;
drop policy if exists teacher_assignments_not_self_delete on public.teacher_assignments;
