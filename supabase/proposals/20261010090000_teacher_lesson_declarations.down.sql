-- Rollback of the lesson-declaration proposal: removes the function only.
-- Lessons declared through it stay (they are ordinary rows of
-- public.lessons, readable as before); delete them separately if needed.
drop function if exists public.focus_declare_lesson(uuid, uuid, date, text, uuid[]);
