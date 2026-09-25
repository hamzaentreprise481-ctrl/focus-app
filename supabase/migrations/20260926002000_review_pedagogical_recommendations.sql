create or replace function public.focus_review_pedagogical_recommendation(
  p_recommendation_id uuid,
  p_decision text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rec public.pedagogical_recommendations%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  if p_decision not in ('validate','dismiss') then
    raise exception 'invalid decision' using errcode='22023';
  end if;

  select * into v_rec
  from public.pedagogical_recommendations
  where id=p_recommendation_id;

  if not found then
    raise exception 'recommendation not found' using errcode='42501';
  end if;

  if not (
    v_rec.created_by=(select auth.uid())
    or public.is_school_admin(v_rec.school_id)
  ) then
    raise exception 'recommendation not writable' using errcode='42501';
  end if;

  if p_decision='validate' then
    update public.pedagogical_recommendations
    set teacher_validated=true,
        dismissed_at=null
    where id=p_recommendation_id;

    update public.error_observations
    set verified_by_teacher=true
    where analysis_run_id=v_rec.analysis_run_id
      and curriculum_node_id=v_rec.curriculum_node_id
      and student_id=v_rec.student_id
      and assessment_id=v_rec.assessment_id;
  else
    update public.pedagogical_recommendations
    set teacher_validated=false,
        dismissed_at=now()
    where id=p_recommendation_id;
  end if;
end;
$$;

revoke all on function public.focus_review_pedagogical_recommendation(uuid,text) from public;
revoke all on function public.focus_review_pedagogical_recommendation(uuid,text) from anon;
grant execute on function public.focus_review_pedagogical_recommendation(uuid,text) to authenticated;
