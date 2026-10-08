// Minimal RFC 4180 CSV reader/writer for curriculum packages.
//
// - accepts "," or ";" delimiters (French spreadsheet exports use ";"),
// - quoted fields with doubled quotes and embedded newlines,
// - CRLF / LF line endings and an optional UTF-8 BOM,
// - reports the physical line where each record starts.

export interface CsvRecord {
  line: number;
  fields: string[];
}

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

export function detectDelimiter(text: string): "," | ";" {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") commas++;
    else if (!quoted && char === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(
  input: string,
  delimiter: "," | ";" = detectDelimiter(input),
): CsvRecord[] {
  const text = stripBom(input);
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  let fieldWasQuoted = false;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    // Skip fully blank lines (a single empty unquoted field).
    if (!(fields.length === 1 && fields[0] === "")) {
      records.push({ line: recordLine, fields });
    }
    fields = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        const next = text[i];
        if (
          next !== undefined &&
          next !== delimiter &&
          next !== "\n" &&
          next !== "\r"
        )
          throw new CsvSyntaxError(
            "Caractère inattendu après un guillemet fermant.",
            line,
          );
        continue;
      }
      if (char === "\n") line++;
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      if (field.length > 0 || fieldWasQuoted)
        throw new CsvSyntaxError(
          "Guillemet au milieu d’un champ non entre guillemets.",
          line,
        );
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (char === delimiter) {
      endField();
      i++;
      continue;
    }
    if (char === "\r" || char === "\n") {
      endRecord();
      if (char === "\r" && text[i + 1] === "\n") i++;
      i++;
      line++;
      recordLine = line;
      continue;
    }
    field += char;
    i++;
  }

  if (inQuotes)
    throw new CsvSyntaxError("Guillemet ouvrant sans guillemet fermant.", recordLine);
  if (field.length > 0 || fields.length > 0 || fieldWasQuoted) endRecord();
  return records;
}

export interface CsvTable {
  header: string[];
  rows: Array<{ line: number; values: Record<string, string> }>;
}

// Parses a CSV with a header row. Column names are trimmed and lower-cased.
// Throws CsvSyntaxError for structural problems (wrong column count, etc.).
export function parseCsvTable(input: string): CsvTable {
  const records = parseCsv(input);
  if (!records.length) throw new CsvSyntaxError("Fichier CSV vide.", 1);
  const [headerRecord, ...dataRecords] = records;
  const header = headerRecord.fields.map((name) => name.trim().toLowerCase());
  const seen = new Set<string>();
  for (const name of header) {
    if (!name)
      throw new CsvSyntaxError("Nom de colonne vide dans l’en-tête.", headerRecord.line);
    if (seen.has(name))
      throw new CsvSyntaxError(`Colonne « ${name} » en double.`, headerRecord.line);
    seen.add(name);
  }

  return {
    header,
    rows: dataRecords.map((record) => {
      if (record.fields.length !== header.length)
        throw new CsvSyntaxError(
          `${record.fields.length} colonnes trouvées, ${header.length} attendues.`,
          record.line,
        );
      const values: Record<string, string> = {};
      header.forEach((name, index) => {
        values[name] = record.fields[index];
      });
      return { line: record.line, values };
    }),
  };
}

function quote(value: string, delimiter: string) {
  return /["\r\n]/.test(value) || value.includes(delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function writeCsv(
  header: string[],
  rows: string[][],
  delimiter: "," | ";" = ",",
): string {
  return (
    [header, ...rows]
      .map((row) => row.map((value) => quote(value, delimiter)).join(delimiter))
      .join("\n") + "\n"
  );
}
