import { PDFDocument, PageSizes, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { SchoolReport } from "./school-report";

/** Runs on demand in the browser. No academic data is sent to an export service. */
export async function renderSchoolPdf(report: SchoolReport, fontBytes: Uint8Array, exportedAt = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  doc.setTitle(report.title);
  doc.setCreator("FOCUS Teacher");
  doc.setLanguage("fr-FR");
  doc.setCreationDate(exportedAt);
  const margin = 44;
  const width = PageSizes.A4[0] - margin * 2;
  const ink = rgb(0.13, 0.18, 0.2);
  const muted = rgb(0.35, 0.4, 0.42);
  const brand = rgb(0.13, 0.37, 0.33);
  let page = doc.addPage(PageSizes.A4);
  let y = 755;
  const date = exportedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  function header() {
    page.drawText("FOCUS / Suivi pédagogique", { x: margin, y: 802, size: 10, font, color: brand });
    page.drawText(`Export du ${date}`, { x: margin, y: 784, size: 8, font, color: muted });
    if (report.source === "demo") page.drawText("DÉMONSTRATION - DONNÉES FICTIVES", { x: 302, y: 802, size: 8, font, color: muted });
  }
  header();
  function ensure(height: number) {
    if (y - height < 60) {
      page = doc.addPage(PageSizes.A4);
      y = 755;
      header();
    }
  }
  function lines(text: string, size: number) {
    const output: string[] = [];
    for (const paragraph of text.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
        if (line) output.push(line);
        line = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > width && line) { output.push(line); line = ""; }
          line += char;
        }
      }
      output.push(line);
    }
    return output;
  }
  function paragraph(text: string, size = 10, color = ink) {
    const wrapped = lines(text, size);
    const leading = size * 1.5;
    // Keep short entries together, split exceptionally long paragraphs safely.
    ensure(Math.min(wrapped.length * leading + 6, 100));
    for (const line of wrapped) {
      ensure(leading);
      page.drawText(line, { x: margin, y, size, font, color });
      y -= leading;
    }
    y -= 8;
  }
  paragraph(report.title, 19, brand);
  paragraph(report.subtitle, 11, muted);
  paragraph("Lecture indicative fondée sur les observations saisies. À confirmer par le professeur. Ce document n'est pas un bulletin officiel.", 9, muted);
  for (const section of report.sections) {
    const headingLines = lines(section.title, 12).length;
    ensure(headingLines * 18 + 50);
    y -= 8;
    paragraph(section.title, 12, brand);
    for (const text of section.paragraphs.length ? section.paragraphs : ["Aucune donnée renseignée."]) paragraph(text);
  }
  doc.getPages().forEach((p, index) => {
    p.drawLine({ start: { x: margin, y: 43 }, end: { x: margin + width, y: 43 }, thickness: 0.5, color: rgb(0.8, 0.84, 0.83) });
    p.drawText(`FOCUS - Document pédagogique · ${index + 1} / ${doc.getPageCount()}`, { x: margin, y: 28, size: 8, font, color: muted });
  });
  return doc.save();
}
