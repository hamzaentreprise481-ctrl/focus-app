# Curriculum knowledge base

FOCUS maps every pedagogical recommendation to a node of an official curriculum
graph. This folder holds the graph as reviewable packages, and
`npm run curriculum` validates and imports them.

`packages/math/seconde-gt-2026-2027/` is the current 44-node graph (seeded by the
`pedagogical_ai_math_v1` and `enrich_math_graph_core` migrations), exported
exactly. A test proves that importing it into a migrated database changes
nothing, so it is the starting point for a complete programme: extend it rather
than starting from scratch, and keep existing codes.

## Content rule

Store **short labels written for FOCUS** and a **source locator** (section,
page). Never paste programme text, textbook text, exercises or corrections.
The validator and the database refuse titles over 160 characters, descriptions
over 300 and locators over 200. Source URLs must be `https` on `*.gouv.fr` or
`*.education.fr`.

## Package format (version 1)

A package is the **complete** declaration of one official source (one
programme, one level). Two equivalent forms:

### CSV folder (spreadsheet-friendly)

```
source.json   {"formatVersion": 1, "source": {...}}
nodes.csv     one row per node
edges.csv     optional, extra relationships
```

`source` fields: `subjectCode` (`MATH`), `levelCode` (`SECONDE_GT`,
`PREMIERE_SPE`…), `schoolYear` (`2026-2027`), `title`, `publisher`,
`officialReference` (BO number, NOR), `sourceUrl` (identifies the source),
`publishedOn` (`YYYY-MM-DD` or `null`).

`nodes.csv` columns (`,` or `;` separated, UTF-8):

| column           | required | content                                                                 |
| ---------------- | -------- | ----------------------------------------------------------------------- |
| `code`           | yes      | `MATH.ALG.EQUATION_PREMIER_DEGRE` — UPPERCASE segments, starts with the subject code, 120 chars max, never reused for another meaning |
| `type`           | yes      | `notion`, `competency`, `prerequisite` (prior-cycle knowledge) or `domain` |
| `title`          | yes      | short label                                                             |
| `description`    | no       | one short FOCUS-written sentence                                        |
| `source_locator` | yes      | where it is in the official text                                        |
| `part_of`        | no       | broader node(s), `\|`-separated                                          |
| `prerequisites`  | no       | node(s) that are prerequisites of this one, `\|`-separated               |
| `competencies`   | no       | competency node(s) this node supports, `\|`-separated                    |

`edges.csv` columns: `from`, `to`, `relation` — for anything not expressible
inline, typically `supports` between two notions.

### JSON file

```json
{
  "formatVersion": 1,
  "source": { "subjectCode": "MATH", "levelCode": "SECONDE_GT", "...": "..." },
  "nodes": [
    {
      "code": "MATH.ALG.DISTRIBUTIVITE",
      "type": "notion",
      "title": "Développement par distributivité",
      "description": "Distribuer correctement un facteur et réduire une expression simple.",
      "sourceLocator": "BO 2026 Seconde — Automatismes / algèbre, PDF p.337",
      "partOf": ["MATH.ALG.EXPRESSIONS"],
      "prerequisites": ["MATH.PREREQ.CYCLE4.DISTRIBUTIVITE"],
      "competencies": ["MATH.COMP.CALCULER"]
    }
  ],
  "edges": [{ "from": "MATH.ALG.DISTRIBUTIVITE", "to": "MATH.ALG.FORME_ADAPTEE", "relation": "supports" }]
}
```

### Relationships

| relation          | allowed (from → to)                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| `prerequisite_of` | notion → notion, prerequisite → notion                                    |
| `supports`        | notion → competency, notion → notion, prerequisite → competency           |
| `part_of`         | notion → notion, notion → domain, domain → domain, competency → competency |

Errors (import refused): unknown or duplicate codes, a relationship declared
twice, **more than one relationship between the same two nodes** (in either
direction), forbidden type pairs, self-loops, `prerequisite_of` or `part_of`
cycles (also across packages), relationships between two nodes of other
sources, unknown columns or fields.

Warnings (import allowed): isolated nodes, notions supporting no competency
(recommendations will show none), unused prerequisite nodes, prerequisites
already implied by a chain.

A package may reference nodes of another source (for example a Première notion
whose prerequisite is a Seconde notion). Validate it with the other package as
context: `--with path/to/seconde`. Repeat `--with` for a chain, in dependency
order — each context package is validated with the ones before it
(`--with seconde --with premiere` for a Terminale package).

The 25,000-relationship limit counts every relationship, inline ones
(`part_of`, `prerequisites`, `competencies`) included.

## Work documents (rich format)

`curriculum/work/FOCUS_Maths_Seconde_2026-2027.json` is the full Maths Seconde
document produced by Work (`schema_version` 1.0.0, status
`draft_for_teacher_review`, SHA-256 `7a7a49ac…abbd37fe3`, pinned in tests). The
CLI recognizes this format and converts only its graph — codes, types and
relations unchanged — to a package.

**A. Graph data the importer can take** (`curriculum_nodes`, relationships):
99 nodes (89 notions, 6 competencies, 4 prerequisites; the 44 existing codes
keep their type and UUID) and 348 relationships, of which 322 are undisputed.

**B. Catalogue** (`curriculum_objectives`, `curriculum_typical_errors`,
`curriculum_remediations`, `curriculum_remediation_targets`): 272 objectives,
99 typical errors and 99 remediations with their check questions, imported by
`catalogue-sql` into a separate, generated migration. Every row keeps its Work
provenance and is marked as an editorial FOCUS proposal, not teacher-validated.
Teachers read it; only `focus_import_curriculum_catalogue` (service_role, dry
run by default, upsert by code, deactivate-only) writes it. The analysis may
link a finding to a typical error **of the same notion** only (checked in
TypeScript and by the database), and the student file then shows the matching
remediation and check question as a suggestion.

**C. Work data with no database schema yet** (reported, never imported):
8 domains, 14 chapters, 308 coverage rows, relationship provenance and
normative flags, teacher-validation flags (0/99 nodes, 0/348 relationships).

### Disputed relationships

16 relationships break the importer rules, so the exact file is rejected:

- 6 `supports` links between two competencies (`competency_support`);
- 7 node pairs where an existing `supports` was kept next to a new
  `prerequisite_of` (`support_and_prerequisite`);
- 3 node pairs where a node is `part_of` a parent that is also declared its
  prerequisite (`part_of_and_prerequisite`: `FONC.TABLEAU_SIGNES`/`FONC.SIGNES`,
  `STAT.POURCENTAGE_POURCENTAGE` and `STAT.EVOLUTIONS` under `STAT.PROPORTIONS`).

FOCUS does not choose between them. `FOCUS_Maths_Seconde_2026-2027.decisions.json`
lists 15 disputes — one per node pair, 26 relationships in all (the 16 rejected
ones and the relationships they conflict with; `RAISONNER`/`COMMUNIQUER` has a
competency link in each direction) — with each edge (index, relation, Work
provenance) and the only options that make the pair valid; every `keep` is
`null` (pending). To decide, copy an
option's `keep` array into `keep` and sign `decidedBy`. A decision is applied
only if it matches a listed option, is signed, and the file's SHA-256 still
matches; pending disputes stay blocking.

```bash
npm run curriculum -- work-disputes curriculum/work/FOCUS_Maths_Seconde_2026-2027.json --out decisions.json
npm run curriculum -- validate curriculum/work/FOCUS_Maths_Seconde_2026-2027.json \
  --decisions curriculum/work/FOCUS_Maths_Seconde_2026-2027.decisions.json
```

#### What is imported while the disputes are pending

The committed import (`20260926160000_curriculum_work_seconde_2026.sql`) is
generated with `--defer-disputes <live package>`: for each pending dispute,
the single relationship **already live** is kept when it is one of the listed
options, and every other relationship of the dispute is left out. This keeps
the graph exactly as meaningful as it was, adds nothing FOCUS would have
chosen, and blocks nothing else:

- kept as they are (8): the 7 existing `supports` of the
  `support_and_prerequisite` pairs, and `FONC.TABLEAU_SIGNES part_of FONC.SIGNES`;
- left out until an author decides (18): the 8 `prerequisite_of` proposed next
  to them, the 4 `STAT.POURCENTAGE_POURCENTAGE` / `STAT.EVOLUTIONS` edges, and
  the 6 competency-to-competency `supports`.

Result: 99 nodes (the 44 live UUIDs preserved, 55 added, none deactivated) and
330 relationships; re-running it changes nothing (tested on a replica of the
live database). Once `keep` is signed in the decisions file, regenerate the
migration with `--decisions` instead; the importer then applies exactly the
chosen relationships.

## Commands

```bash
# Offline validation (no network). Exit code 1 on errors.
npm run curriculum -- validate curriculum/packages/math/seconde-gt-2026-2027
npm run curriculum -- validate premiere/ --with curriculum/packages/math/seconde-gt-2026-2027

# Generate a reviewable, idempotent Supabase migration (the normal path).
npm run curriculum -- sql curriculum/packages/math/seconde-gt-2026-2027
#   → supabase/migrations/<timestamp>_curriculum_math_seconde_gt.sql

# Or import directly (administrator shell only). Dry run unless --commit.
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run curriculum -- apply curriculum/packages/math/seconde-gt-2026-2027 [--commit]

# Work document, undecided disputes left as they are live (see above).
npm run curriculum -- sql curriculum/work/FOCUS_Maths_Seconde_2026-2027.json \
  --defer-disputes curriculum/packages/math/seconde-gt-2026-2027

# Catalogue of the Work document (objectives, typical errors, remediations).
npm run curriculum -- catalogue-sql curriculum/work/FOCUS_Maths_Seconde_2026-2027.json \
  --out supabase/migrations/<timestamp>_curriculum_catalogue_work_seconde_2026.sql

# Export what the database holds for a source back to a CSV folder. The folder
# then holds exactly that package: an edges.csv left by an earlier export is
# removed when no relationship needs it any more.
npm run curriculum -- export https://www.education.gouv.fr/bo/2026/Hebdo14/MENE2602914A --out /tmp/seconde
```

`SUPABASE_SERVICE_ROLE_KEY` belongs in an administrator's local shell for these
commands only — never in Vercel, the application or git. The application
never uses it (a test enforces this).

## What an import does

`public.focus_import_curriculum(package, dry_run default true,
allow_mass_deactivation default false)` runs in one transaction, serialized by
an advisory lock, and re-validates everything server-side:

- creates or updates the source (identified by `sourceUrl`);
- inserts new nodes, updates changed ones, **deactivates** nodes absent from the
  package (never deletes: observations and recommendations keep their
  reference), reactivates nodes that come back;
- refuses to take over a node owned by another source, to change the type of a
  node already referenced by teacher data, or to deactivate more than 20 % of
  a programme's active nodes — whatever its size — unless
  `--allow-mass-deactivation` is given (protects against a truncated file);
- replaces this source's relationship **declarations**
  (`curriculum_edge_declarations`). Several sources may declare the same
  relationship; it stays in the graph until the last of them stops declaring
  it (`adopted` / `released` in the report), and each source's export lists
  exactly what it declares;
- rejects conflicts and cycles against the whole graph;
- returns a report (nodes: `inserted`, `updated`, `reactivated`, `unchanged`,
  `deactivated`; relationships: `inserted`, `adopted`, `unchanged`,
  `released`, `deleted`) and logs committed changes in `curriculum_import_runs`.

Importing the same package twice is a strict no-op: no row is rewritten and no
audit row is added. A dry run computes the exact same report and rolls back.

## How the AI reads the graph

`public.focus_curriculum_graph(subject, levels)` returns the active nodes of the
class's level (resolved from `classes.level`, e.g. "Seconde" → `SECONDE_GT`)
plus prior-level prerequisites marked `inScope: false`, in one JSON value
ordered by code (no row cap, stable analysis hashes). The model receives, per
node, `parents`, `prerequisites`, `competencies` (competency nodes only) and
`supports` (notions), and may only attach a recommendation to an in-scope
notion.
