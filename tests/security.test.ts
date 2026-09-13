import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isTeacher, safeNext } from "../lib/auth/policy";
import { marketingDemo } from "../lib/demo/marketing-data";

test("only administrator-authorized non-anonymous teachers are accepted", () => {
  assert.equal(
    isTeacher({ app_metadata: { role: "teacher" }, is_anonymous: false }),
    true,
  );
  for (const user of [
    null,
    {},
    { app_metadata: { role: "parent" } },
    { app_metadata: { role: "student" } },
    { user_metadata: { role: "teacher" } },
    { app_metadata: { role: "teacher" }, is_anonymous: true },
  ])
    assert.equal(isTeacher(user), false);
});
test("redirects stay within the teacher application", () => {
  assert.equal(
    safeNext("/app/eleves/lucas-bernard?tab=notes"),
    "/app/eleves/lucas-bernard?tab=notes",
  );
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/app/../../connexion",
    "/app\\evil",
    "/app/%2e%2e/connexion",
    "/connexion",
    "/application",
    "javascript:alert(1)",
    null,
  ])
    assert.equal(safeNext(value), "/app");
});
test("marketing fixture is immutable, including nested entries", () => {
  assert.ok(Object.isFrozen(marketingDemo));
  assert.ok(Object.isFrozen(marketingDemo.evaluations));
  assert.ok(Object.isFrozen(marketingDemo.evaluations[0]));
  assert.ok(Object.isFrozen(marketingDemo.observation));
});
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
test("all transitive public imports are isolated from application datasets and analysis", () => {
  const visited = new Set<string>();
  function visit(file: string) {
    file = path.resolve(file);
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(
      !/[/\\](?:lib[/\\](?:data[/\\]|analysis\.|demo-store\.|demo-data-context\.)|components[/\\](?:students|dashboard|evaluations)|app[/\\]\(teacher\))/.test(
        file,
      ),
      `Public dependency: ${file}`,
    );
    if (!/\.(tsx?|mjs)$/.test(file)) return;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const refs: string[] = [];
    function nodes(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        refs.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require")
      )
        refs.push(node.arguments[0].text);
      ts.forEachChild(node, nodes);
    }
    nodes(source);
    for (const ref of refs) {
      if (!ref.startsWith(".") && !ref.startsWith("@/")) continue;
      const base = ref.startsWith("@/")
        ? path.resolve(ref.slice(2))
        : path.resolve(path.dirname(file), ref);
      const resolved = [
        base,
        ...[".ts", ".tsx", ".mjs", ".css", "/index.ts", "/index.tsx"].map(
          (ext) => base + ext,
        ),
      ].find(existsSync);
      assert.ok(resolved, `Unresolved import: ${ref}`);
      visit(resolved);
    }
  }
  [...walk("app/(marketing)"), ...walk("app/(auth)"), "app/layout.tsx"].forEach(
    visit,
  );
});
test("every teacher page checks authentication before rendering", () => {
  const pages = walk("app/(teacher)").filter((f) => path.basename(f) === "page.tsx");
  assert.ok(pages.length >= 9);
  for (const file of pages)
    assert.match(readFileSync(file, "utf8"), /await requireTeacher\(\)/);
});
