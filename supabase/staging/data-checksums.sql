-- Read-only. Row count and content checksum of every table of the public
-- schema, over the columns that exist at 20261004090000 (the live head on
-- 9 October 2026). Generated from the migrations; valid before AND after the
-- pending migrations, which only ADD columns (student_responses.source,
-- legibility, transcription_verified; ai_analysis_runs.question_outcomes).
-- Run it on the live project just before and just after applying them:
-- every line must be identical. tests/live-upgrade-rehearsal.test.ts runs it
-- on a replica.
select 'academic_years' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "name", "starts_at", "ends_at", "active", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "name", "starts_at", "ends_at", "active", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."academic_years"
union all
select 'ai_analysis_runs' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "teacher_id", "student_id", "assessment_id", "model", "input_hash", "status", "failure_reason", "created_at", "completed_at", "superseded_at")::text, E'\n' order by row("id", "school_id", "teacher_id", "student_id", "assessment_id", "model", "input_hash", "status", "failure_reason", "created_at", "completed_at", "superseded_at")::text collate "C"), '')) as checksum from public."ai_analysis_runs"
union all
select 'ai_usage_events' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "teacher_id", "assessment_id", "analysis_run_id", "model", "reasoning_effort", "outcome", "model_called", "latency_ms", "input_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "rejected_candidates", "created_at")::text, E'\n' order by row("id", "school_id", "teacher_id", "assessment_id", "analysis_run_id", "model", "reasoning_effort", "outcome", "model_called", "latency_ms", "input_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "rejected_candidates", "created_at")::text collate "C"), '')) as checksum from public."ai_usage_events"
union all
select 'assessment_competencies' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("assessment_id", "competency_id")::text, E'\n' order by row("assessment_id", "competency_id")::text collate "C"), '')) as checksum from public."assessment_competencies"
union all
select 'assessment_materials' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("assessment_id", "context_text", "instructions_text", "updated_by", "updated_at")::text, E'\n' order by row("assessment_id", "context_text", "instructions_text", "updated_by", "updated_at")::text collate "C"), '')) as checksum from public."assessment_materials"
union all
select 'assessment_questions' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "assessment_id", "position", "prompt", "correction_text", "rubric", "max_points", "created_at", "updated_at")::text, E'\n' order by row("id", "assessment_id", "position", "prompt", "correction_text", "rubric", "max_points", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."assessment_questions"
union all
select 'assessment_results' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "assessment_id", "student_id", "score", "absent", "teacher_comment", "created_at", "updated_at")::text, E'\n' order by row("id", "assessment_id", "student_id", "score", "absent", "teacher_comment", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."assessment_results"
union all
select 'assessments' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "class_id", "subject_id", "teacher_id", "title", "date", "coefficient", "created_at", "updated_at", "important")::text, E'\n' order by row("id", "school_id", "class_id", "subject_id", "teacher_id", "title", "date", "coefficient", "created_at", "updated_at", "important")::text collate "C"), '')) as checksum from public."assessments"
union all
select 'classes' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "academic_year_id", "name", "level", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "academic_year_id", "name", "level", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."classes"
union all
select 'competencies' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "subject_id", "name", "code", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "subject_id", "name", "code", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."competencies"
union all
select 'competency_results' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "assessment_result_id", "competency_id", "mastery_level", "created_at", "updated_at")::text, E'\n' order by row("id", "assessment_result_id", "competency_id", "mastery_level", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."competency_results"
union all
select 'curriculum_catalogue_imports' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "source_id", "package_hash", "report", "imported_at")::text, E'\n' order by row("id", "source_id", "package_hash", "report", "imported_at")::text collate "C"), '')) as checksum from public."curriculum_catalogue_imports"
union all
select 'curriculum_edge_declarations' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("from_node_id", "to_node_id", "relation", "source_id", "declared_at")::text, E'\n' order by row("from_node_id", "to_node_id", "relation", "source_id", "declared_at")::text collate "C"), '')) as checksum from public."curriculum_edge_declarations"
union all
select 'curriculum_edges' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("from_node_id", "to_node_id", "relation", "created_at")::text, E'\n' order by row("from_node_id", "to_node_id", "relation", "created_at")::text collate "C"), '')) as checksum from public."curriculum_edges"
union all
select 'curriculum_import_runs' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "source_id", "package_hash", "format_version", "report", "imported_by", "imported_at")::text, E'\n' order by row("id", "source_id", "package_hash", "format_version", "report", "imported_by", "imported_at")::text collate "C"), '')) as checksum from public."curriculum_import_runs"
union all
select 'curriculum_nodes' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "source_id", "code", "node_type", "title", "description", "source_locator", "active", "created_at")::text, E'\n' order by row("id", "source_id", "code", "node_type", "title", "description", "source_locator", "active", "created_at")::text collate "C"), '')) as checksum from public."curriculum_nodes"
union all
select 'curriculum_objectives' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "code", "node_id", "position", "text", "provenance", "source_locator", "teacher_validated", "active", "created_at", "updated_at")::text, E'\n' order by row("id", "code", "node_id", "position", "text", "provenance", "source_locator", "teacher_validated", "active", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."curriculum_objectives"
union all
select 'curriculum_remediation_targets' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("remediation_id", "error_id")::text, E'\n' order by row("remediation_id", "error_id")::text collate "C"), '')) as checksum from public."curriculum_remediation_targets"
union all
select 'curriculum_remediations' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "code", "node_id", "position", "title", "steps", "duration_minutes", "duration_is_official", "check_prompt", "check_expected_answer", "check_success_criterion", "provenance", "source_locator", "teacher_validated", "active", "created_at", "updated_at")::text, E'\n' order by row("id", "code", "node_id", "position", "title", "steps", "duration_minutes", "duration_is_official", "check_prompt", "check_expected_answer", "check_success_criterion", "provenance", "source_locator", "teacher_validated", "active", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."curriculum_remediations"
union all
select 'curriculum_sources' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "subject_code", "level_code", "school_year", "title", "publisher", "official_reference", "source_url", "published_on", "created_at")::text, E'\n' order by row("id", "subject_code", "level_code", "school_year", "title", "publisher", "official_reference", "source_url", "published_on", "created_at")::text collate "C"), '')) as checksum from public."curriculum_sources"
union all
select 'curriculum_typical_errors' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "code", "node_id", "position", "description", "evidence_required", "alternative_explanations", "frequency_status", "provenance", "teacher_validated", "active", "created_at", "updated_at")::text, E'\n' order by row("id", "code", "node_id", "position", "description", "evidence_required", "alternative_explanations", "frequency_status", "provenance", "teacher_validated", "active", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."curriculum_typical_errors"
union all
select 'error_observations' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "analysis_run_id", "school_id", "student_id", "assessment_id", "question_id", "student_response_id", "curriculum_node_id", "error_type", "evidence_excerpt", "explanation", "confidence", "source", "created_by", "verified_by_teacher", "created_at", "catalogue_error_id", "teacher_decision")::text, E'\n' order by row("id", "analysis_run_id", "school_id", "student_id", "assessment_id", "question_id", "student_response_id", "curriculum_node_id", "error_type", "evidence_excerpt", "explanation", "confidence", "source", "created_by", "verified_by_teacher", "created_at", "catalogue_error_id", "teacher_decision")::text collate "C"), '')) as checksum from public."error_observations"
union all
select 'homework' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "class_id", "subject_id", "teacher_id", "title", "instructions", "due_date", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "class_id", "subject_id", "teacher_id", "title", "instructions", "due_date", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."homework"
union all
select 'homework_resources' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "homework_id", "label", "url", "created_at")::text, E'\n' order by row("id", "homework_id", "label", "url", "created_at")::text collate "C"), '')) as checksum from public."homework_resources"
union all
select 'homework_views' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "homework_id", "student_id", "viewed_at")::text, E'\n' order by row("id", "homework_id", "student_id", "viewed_at")::text collate "C"), '')) as checksum from public."homework_views"
union all
select 'learning_activities' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "learning_path_id", "position", "activity_type", "content", "created_at")::text, E'\n' order by row("id", "learning_path_id", "position", "activity_type", "content", "created_at")::text collate "C"), '')) as checksum from public."learning_activities"
union all
select 'learning_paths' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "student_id", "competency_id", "lesson_absence_id", "origin", "status", "estimated_minutes", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "student_id", "competency_id", "lesson_absence_id", "origin", "status", "estimated_minutes", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."learning_paths"
union all
select 'lesson_absences' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "lesson_id", "student_id", "catch_up_status", "created_at", "updated_at")::text, E'\n' order by row("id", "lesson_id", "student_id", "catch_up_status", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."lesson_absences"
union all
select 'lesson_competencies' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("lesson_id", "competency_id")::text, E'\n' order by row("lesson_id", "competency_id")::text collate "C"), '')) as checksum from public."lesson_competencies"
union all
select 'lessons' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "class_id", "subject_id", "teacher_id", "date", "summary", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "class_id", "subject_id", "teacher_id", "date", "summary", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."lessons"
union all
select 'pedagogical_recommendations' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "analysis_run_id", "school_id", "student_id", "assessment_id", "curriculum_node_id", "difficulty", "evidence", "confidence", "explanation", "recommended_action", "created_by", "teacher_validated", "dismissed_at", "created_at", "catalogue_error_id", "superseded_at", "teacher_decision", "teacher_decided_at", "teacher_decided_by", "teacher_note")::text, E'\n' order by row("id", "analysis_run_id", "school_id", "student_id", "assessment_id", "curriculum_node_id", "difficulty", "evidence", "confidence", "explanation", "recommended_action", "created_by", "teacher_validated", "dismissed_at", "created_at", "catalogue_error_id", "superseded_at", "teacher_decision", "teacher_decided_at", "teacher_decided_by", "teacher_note")::text collate "C"), '')) as checksum from public."pedagogical_recommendations"
union all
select 'pedagogical_review_events' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "recommendation_id", "school_id", "student_id", "decision", "note", "decided_by", "decided_at")::text, E'\n' order by row("id", "recommendation_id", "school_id", "student_id", "decision", "note", "decided_by", "decided_at")::text collate "C"), '')) as checksum from public."pedagogical_review_events"
union all
select 'profiles' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "first_name", "last_name", "created_at", "updated_at")::text, E'\n' order by row("id", "first_name", "last_name", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."profiles"
union all
select 'question_curriculum_nodes' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("question_id", "curriculum_node_id", "relation", "created_at")::text, E'\n' order by row("question_id", "curriculum_node_id", "relation", "created_at")::text collate "C"), '')) as checksum from public."question_curriculum_nodes"
union all
select 'school_memberships' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "user_id", "role", "status", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "user_id", "role", "status", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."school_memberships"
union all
select 'schools' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "name", "created_at", "updated_at")::text, E'\n' order by row("id", "name", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."schools"
union all
select 'student_enrollments' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "student_id", "class_id", "academic_year_id", "created_at")::text, E'\n' order by row("id", "school_id", "student_id", "class_id", "academic_year_id", "created_at")::text collate "C"), '')) as checksum from public."student_enrollments"
union all
select 'student_progress' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "student_id", "learning_activity_id", "completed_at", "was_correct", "created_at")::text, E'\n' order by row("id", "student_id", "learning_activity_id", "completed_at", "was_correct", "created_at")::text collate "C"), '')) as checksum from public."student_progress"
union all
select 'student_responses' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "assessment_id", "question_id", "student_id", "response_text", "awarded_points", "teacher_annotation", "created_at", "updated_at")::text, E'\n' order by row("id", "assessment_id", "question_id", "student_id", "response_text", "awarded_points", "teacher_annotation", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."student_responses"
union all
select 'subjects' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "name", "code", "created_at", "updated_at")::text, E'\n' order by row("id", "school_id", "name", "code", "created_at", "updated_at")::text collate "C"), '')) as checksum from public."subjects"
union all
select 'teacher_assignments' as "table", count(*)::bigint as "rows", md5(coalesce(string_agg(row("id", "school_id", "teacher_id", "class_id", "subject_id", "created_at")::text, E'\n' order by row("id", "school_id", "teacher_id", "class_id", "subject_id", "created_at")::text collate "C"), '')) as checksum from public."teacher_assignments"
order by 1;
