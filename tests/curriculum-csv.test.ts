import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CsvSyntaxError,
  detectDelimiter,
  parseCsv,
  parseCsvTable,
  writeCsv,
} from "../lib/curriculum/csv";

test("parses quoted fields, doubled quotes, embedded delimiters and newlines", () => {
  const records = parseCsv(
    'code,title\r\nA,"Calcul littéral : développer, factoriser"\r\nB,"Il dit ""x"" puis\nretour"\r\n',
  );
  assert.deepEqual(records, [
    { line: 1, fields: ["code", "title"] },
    { line: 2, fields: ["A", "Calcul littéral : développer, factoriser"] },
    { line: 3, fields: ["B", 'Il dit "x" puis\nretour'] },
  ]);
});

test("detects French spreadsheet exports using semicolons and strips the BOM", () => {
  const text = "﻿code;title;description\nMATH.A;Titre, avec virgule;\n";
  assert.equal(detectDelimiter(text), ";");
  const table = parseCsvTable(text);
  assert.deepEqual(table.header, ["code", "title", "description"]);
  assert.deepEqual(table.rows[0].values, {
    code: "MATH.A",
    title: "Titre, avec virgule",
    description: "",
  });
});

test("skips blank lines but keeps physical line numbers for error messages", () => {
  const table = parseCsvTable("code,title\n\nMATH.A,Un\n\nMATH.B,Deux\n");
  assert.deepEqual(
    table.rows.map((row) => row.line),
    [3, 5],
  );
});

test("rejects malformed CSV with the line of the problem", () => {
  assert.throws(
    () => parseCsvTable("code,title\nMATH.A,Un,en trop\n"),
    (error: unknown) => error instanceof CsvSyntaxError && error.line === 2,
  );
  assert.throws(
    () => parseCsv('code,title\nMATH.A,"non fermé\n'),
    (error: unknown) => error instanceof CsvSyntaxError && error.line === 2,
  );
  assert.throws(() => parseCsv('a,b"c\n'), CsvSyntaxError);
  assert.throws(() => parseCsvTable("code,Code\n"), CsvSyntaxError);
});

test("writer output reads back identically", () => {
  const rows = [
    ["MATH.A", 'Guillemets "internes"', "a|b"],
    ["MATH.B", "ligne\nsuivante", ""],
  ];
  const text = writeCsv(["code", "title", "list"], rows);
  assert.deepEqual(
    parseCsvTable(text).rows.map((row) => Object.values(row.values)),
    rows,
  );
});
