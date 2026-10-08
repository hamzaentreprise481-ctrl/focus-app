-- Fonctions d'autorisation, toutes SECURITY DEFINER + STABLE.
--
-- Pourquoi : une policy RLS sur `school_memberships` qui interrogerait
-- directement `school_memberships` pour vérifier un rôle provoquerait une
-- récursion. En passant par une fonction SECURITY DEFINER, la lecture
-- interne à la fonction s'exécute avec les privilèges du propriétaire de la
-- fonction (donc SANS re-déclencher RLS sur la table lue), ce qui casse la
-- boucle. C'est le pattern recommandé par Supabase pour ce cas précis.
--
-- Toutes ces fonctions sont `stable` (pas de mutation) et fixent
-- `search_path` explicitement (bonne pratique de sécurité Postgres pour les
-- fonctions SECURITY DEFINER, qui évite un détournement via search_path).

create or replace function is_school_admin(target_school_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from school_memberships
    where user_id = auth.uid()
      and school_id = target_school_id
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function is_school_member(target_school_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from school_memberships
    where user_id = auth.uid()
      and school_id = target_school_id
      and status = 'active'
  );
$$;

create or replace function teaches_class(target_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from teacher_assignments
    where teacher_id = auth.uid()
      and class_id = target_class_id
  );
$$;

create or replace function enrolled_in_class(target_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from student_enrollments
    where student_id = auth.uid()
      and class_id = target_class_id
  );
$$;

-- Utilisé pour les compétences/matières "globales" (school_id null) : tout
-- utilisateur authentifié peut les lire, mais seule une école peut lire ses
-- propres ressources privées.
create or replace function can_read_school_scoped(target_school_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select target_school_id is null or is_school_member(target_school_id);
$$;

-- Vrai si l'utilisateur courant et `other_user_id` partagent une classe,
-- dans un sens ou l'autre (enseignant<->élève). Sert à autoriser un
-- enseignant à voir le profil/les parcours de SES élèves, et réciproquement.
create or replace function shares_class_with(other_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from teacher_assignments ta
    join student_enrollments se on se.class_id = ta.class_id
    where (ta.teacher_id = auth.uid() and se.student_id = other_user_id)
       or (ta.teacher_id = other_user_id and se.student_id = auth.uid())
  );
$$;
