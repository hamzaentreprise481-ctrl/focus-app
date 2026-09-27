-- Enrich the Seconde 2026-2027 math graph with fine-grained nodes.
with src as (
  select id from public.curriculum_sources
  where source_url='https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A'
), seed(code,node_type,title,description,source_locator) as (
  values
  ('MATH.NUM.FRACTIONS.OPERATIONS','notion','Opérations sur les fractions','Effectuer et contrôler des opérations sur des fractions simples.','BO 2026 Seconde — Automatismes / Nombres et calculs, PDF p.337-339'),
  ('MATH.NUM.FRACTIONS.IRREDUCTIBLE','notion','Fraction irréductible','Présenter une fraction sous forme irréductible en mobilisant multiples et diviseurs.','BO 2026 Seconde — Arithmétique, PDF p.339'),
  ('MATH.PREREQ.CYCLE4.FRACTIONS','prerequisite','Fractions : acquis du cycle 4','Acquis antérieurs nécessaires pour additionner, multiplier, diviser et comparer des fractions.','BO 2026 Seconde — objectifs Nombres et calculs, PDF p.338'),
  ('MATH.ALG.CALCUL_LITTERAL_ELEMENTAIRE','notion','Calcul littéral élémentaire','Manipuler les écritures additives, multiplicatives et fractionnaires élémentaires.','BO 2026 Seconde — Automatismes, PDF p.337'),
  ('MATH.ALG.DISTRIBUTIVITE','notion','Développement par distributivité','Distribuer correctement un facteur et réduire une expression simple.','BO 2026 Seconde — Automatismes / algèbre, PDF p.337'),
  ('MATH.ALG.IDENTITES','notion','Identités algébriques usuelles','Développer ou factoriser avec les identités (a+b)², (a-b)² et (a+b)(a-b).','BO 2026 Seconde — Automatismes, PDF p.337'),
  ('MATH.ALG.FACTORISATION_SIMPLE','notion','Factorisation simple','Mettre en facteur un facteur commun dans des expressions simples.','BO 2026 Seconde — Automatismes, PDF p.337'),
  ('MATH.ALG.EXPRESSIONS_FRACTIONNAIRES','notion','Expressions algébriques fractionnaires','Effectuer des calculs littéraux simples impliquant des écritures fractionnaires.','BO 2026 Seconde — Algèbre, PDF p.339-340'),
  ('MATH.ALG.FORME_ADAPTEE','notion','Choix de la forme d’une expression','Choisir entre forme factorisée et développée-réduite selon le problème.','BO 2026 Seconde — Algèbre, PDF p.340'),
  ('MATH.ALG.EQUATION_PREMIER_DEGRE','notion','Équation du premier degré','Résoudre et donner l’ensemble des solutions d’une équation du premier degré.','BO 2026 Seconde — Algèbre, PDF p.340'),
  ('MATH.ALG.INEQUATION_PREMIER_DEGRE','notion','Inéquation du premier degré','Résoudre et interpréter une inéquation du premier degré.','BO 2026 Seconde — Algèbre, PDF p.340'),
  ('MATH.ALG.ISOLER_VARIABLE','notion','Isoler une variable','Exprimer une variable en fonction des autres dans une relation simple.','BO 2026 Seconde — Algèbre, PDF p.340'),
  ('MATH.ALG.MODELISER_EQUATION','notion','Modéliser par une équation ou une inéquation','Transformer une situation en relation algébrique exploitable.','BO 2026 Seconde — Nombres et calculs / algèbre, PDF p.338-340'),
  ('MATH.PREREQ.CYCLE4.DISTRIBUTIVITE','prerequisite','Distributivité : acquis du cycle 4','Acquis antérieurs de calcul littéral mobilisés en seconde.','BO 2026 Seconde — objectifs Nombres et calculs, PDF p.338'),
  ('MATH.PREREQ.CYCLE4.EQUATIONS','prerequisite','Équations du premier degré : acquis du cycle 4','Acquis antérieurs nécessaires avant les formes plus variées travaillées en seconde.','BO 2026 Seconde — Nombres réels / algèbre, PDF p.339-340'),
  ('MATH.FONC.NOTION','notion','Notion de fonction','Comprendre la dépendance d’une variable par rapport à une autre.','BO 2026 Seconde — Fonctions, PDF p.342'),
  ('MATH.FONC.IMAGE_ANTECEDENT','notion','Images et antécédents','Déterminer ou interpréter images et antécédents dans différents registres.','BO 2026 Seconde — Automatismes / Fonctions, PDF p.338 et p.342'),
  ('MATH.FONC.DOMAINE','notion','Ensemble de définition','Identifier le domaine d’étude ou l’ensemble de définition d’une fonction.','BO 2026 Seconde — Fonctions, PDF p.342'),
  ('MATH.FONC.AFFINE','notion','Fonction affine','Relier expression, signe, variation et représentation d’une fonction affine.','BO 2026 Seconde — Fonctions, PDF p.342-343'),
  ('MATH.FONC.EQUATIONS_GRAPHIQUES','notion','Équations et inéquations avec des fonctions','Résoudre graphiquement, numériquement ou algébriquement des comparaisons de fonctions.','BO 2026 Seconde — Fonctions, PDF p.342-343'),
  ('MATH.FONC.TABLEAU_SIGNES','notion','Tableau de signes','Exploiter le signe d’une fonction ou d’un produit/quotient pour résoudre un problème.','BO 2026 Seconde — Fonctions, PDF p.342'),
  ('MATH.FONC.VARIATIONS_AFFINE','notion','Variations d’une fonction affine','Relier le signe du coefficient directeur au sens de variation.','BO 2026 Seconde — Variations et extrémums, PDF p.343'),
  ('MATH.PREREQ.CYCLE4.FONCTIONS','prerequisite','Fonctions : acquis du cycle 4','Vocabulaire image, antécédent, représentations et fonctions affines acquis avant la seconde.','BO 2026 Seconde — Fonctions, PDF p.342')
)
insert into public.curriculum_nodes(source_id,code,node_type,title,description,source_locator)
select src.id,seed.code,seed.node_type,seed.title,seed.description,seed.source_locator
from src cross join seed
on conflict(code) do update set
 title=excluded.title,description=excluded.description,source_locator=excluded.source_locator,active=true;

with e(from_code,to_code,relation) as (
 values
 ('MATH.PREREQ.CYCLE4.FRACTIONS','MATH.NUM.FRACTIONS.OPERATIONS','prerequisite_of'),
 ('MATH.NUM.ARITHMETIQUE','MATH.NUM.FRACTIONS.IRREDUCTIBLE','supports'),
 ('MATH.NUM.FRACTIONS.IRREDUCTIBLE','MATH.NUM.FRACTIONS.OPERATIONS','supports'),
 ('MATH.NUM.FRACTIONS.OPERATIONS','MATH.ALG.EXPRESSIONS_FRACTIONNAIRES','prerequisite_of'),
 ('MATH.PREREQ.CYCLE4.DISTRIBUTIVITE','MATH.ALG.DISTRIBUTIVITE','prerequisite_of'),
 ('MATH.ALG.CALCUL_LITTERAL_ELEMENTAIRE','MATH.ALG.DISTRIBUTIVITE','prerequisite_of'),
 ('MATH.ALG.DISTRIBUTIVITE','MATH.ALG.IDENTITES','prerequisite_of'),
 ('MATH.ALG.DISTRIBUTIVITE','MATH.ALG.FACTORISATION_SIMPLE','supports'),
 ('MATH.ALG.DISTRIBUTIVITE','MATH.ALG.EQUATION_PREMIER_DEGRE','prerequisite_of'),
 ('MATH.PREREQ.CYCLE4.EQUATIONS','MATH.ALG.EQUATION_PREMIER_DEGRE','prerequisite_of'),
 ('MATH.ALG.CALCUL_LITTERAL_ELEMENTAIRE','MATH.ALG.ISOLER_VARIABLE','prerequisite_of'),
 ('MATH.ALG.EQUATION_PREMIER_DEGRE','MATH.ALG.MODELISER_EQUATION','supports'),
 ('MATH.ALG.INEQUATION_PREMIER_DEGRE','MATH.ALG.MODELISER_EQUATION','supports'),
 ('MATH.ALG.DISTRIBUTIVITE','MATH.ALG.FORME_ADAPTEE','supports'),
 ('MATH.ALG.FACTORISATION_SIMPLE','MATH.ALG.FORME_ADAPTEE','supports'),
 ('MATH.PREREQ.CYCLE4.FONCTIONS','MATH.FONC.NOTION','prerequisite_of'),
 ('MATH.FONC.NOTION','MATH.FONC.IMAGE_ANTECEDENT','prerequisite_of'),
 ('MATH.FONC.NOTION','MATH.FONC.DOMAINE','prerequisite_of'),
 ('MATH.FONC.IMAGE_ANTECEDENT','MATH.FONC.EQUATIONS_GRAPHIQUES','supports'),
 ('MATH.FONC.AFFINE','MATH.FONC.VARIATIONS_AFFINE','prerequisite_of'),
 ('MATH.FONC.TABLEAU_SIGNES','MATH.FONC.EQUATIONS_GRAPHIQUES','supports'),

 ('MATH.NUM.FRACTIONS.OPERATIONS','MATH.COMP.CALCULER','supports'),
 ('MATH.NUM.FRACTIONS.IRREDUCTIBLE','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.CALCUL_LITTERAL_ELEMENTAIRE','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.DISTRIBUTIVITE','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.IDENTITES','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.FACTORISATION_SIMPLE','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.EXPRESSIONS_FRACTIONNAIRES','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.FORME_ADAPTEE','MATH.COMP.RAISONNER','supports'),
 ('MATH.ALG.EQUATION_PREMIER_DEGRE','MATH.COMP.RAISONNER','supports'),
 ('MATH.ALG.INEQUATION_PREMIER_DEGRE','MATH.COMP.RAISONNER','supports'),
 ('MATH.ALG.ISOLER_VARIABLE','MATH.COMP.CALCULER','supports'),
 ('MATH.ALG.MODELISER_EQUATION','MATH.COMP.MODELISER','supports'),
 ('MATH.FONC.NOTION','MATH.COMP.MODELISER','supports'),
 ('MATH.FONC.IMAGE_ANTECEDENT','MATH.COMP.REPRESENTER','supports'),
 ('MATH.FONC.DOMAINE','MATH.COMP.RAISONNER','supports'),
 ('MATH.FONC.AFFINE','MATH.COMP.REPRESENTER','supports'),
 ('MATH.FONC.EQUATIONS_GRAPHIQUES','MATH.COMP.REPRESENTER','supports'),
 ('MATH.FONC.TABLEAU_SIGNES','MATH.COMP.RAISONNER','supports'),
 ('MATH.FONC.VARIATIONS_AFFINE','MATH.COMP.RAISONNER','supports'),

 ('MATH.ALG.DISTRIBUTIVITE','MATH.ALG.EXPRESSIONS','part_of'),
 ('MATH.ALG.IDENTITES','MATH.ALG.EXPRESSIONS','part_of'),
 ('MATH.ALG.FACTORISATION_SIMPLE','MATH.ALG.EXPRESSIONS','part_of'),
 ('MATH.ALG.EQUATION_PREMIER_DEGRE','MATH.ALG.EQUATIONS','part_of'),
 ('MATH.ALG.INEQUATION_PREMIER_DEGRE','MATH.ALG.EQUATIONS','part_of'),
 ('MATH.FONC.IMAGE_ANTECEDENT','MATH.FONC.REPRESENTATIONS','part_of'),
 ('MATH.FONC.DOMAINE','MATH.FONC.REPRESENTATIONS','part_of'),
 ('MATH.FONC.TABLEAU_SIGNES','MATH.FONC.SIGNES','part_of'),
 ('MATH.FONC.VARIATIONS_AFFINE','MATH.FONC.VARIATIONS','part_of')
)
insert into public.curriculum_edges(from_node_id,to_node_id,relation)
select f.id,t.id,e.relation
from e
join public.curriculum_nodes f on f.code=e.from_code
join public.curriculum_nodes t on t.code=e.to_code
on conflict do nothing;