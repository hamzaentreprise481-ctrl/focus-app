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
`draft_for_teacher_review`). The CLI recognizes this format and converts only
its graph — 99 nodes and 348 relationships, codes, types and relations
unchanged — to a package; everything else (domains, chapters, 272 objectives,
99 typical errors, 99 remediations, coverage rows, relationship provenance) has
no table yet and is reported as not imported.

```bash
npm run curriculum -- validate curriculum/work/FOCUS_Maths_Seconde_2026-2027.json
```

Current result: the 99 nodes are valid (all 44 existing codes kept with their
type), but 16 relationships block the import — 6 `supports` links between two
competencies, and 10 node pairs that carry two relationships: 7 where an
existing `supports` was kept next to a new `prerequisite_of` on the same pair,
and 3 where a node is `part_of` a parent that is also declared its
prerequisite (`FONC.TABLEAU_SIGNES`/`FONC.SIGNES`, and
`STAT.POURCENTAGE_POURCENTAGE`, `STAT.EVOLUTIONS` under `STAT.PROPORTIONS`).
They need an author decision; the importer never picks one.
`tests/curriculum-work.test.ts` pins these facts to the file's SHA-256.

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
