"use client";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSchoolData } from "@/lib/school-data-context";
import { buildSchoolReport, type ReportTarget } from "@/lib/reports/school-report";

export function ExportPdfButton({ target }: { target: ReportTarget }) {
  const { dataset, source, loaded, storageError } = useSchoolData();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    if (lock.current || !loaded || storageError) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const report = buildSchoolReport(dataset, target, source);
      const [{ renderSchoolPdf }, response] = await Promise.all([
        import("@/lib/reports/pdf"), fetch("/fonts/DejaVuSans.ttf"),
      ]);
      if (!response.ok) throw new Error("Police indisponible");
      const bytes = await renderSchoolPdf(report, new Uint8Array(await response.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `focus-${target.kind}-${target.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Keep the URL alive until the browser has started the download.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Le PDF n’a pas pu être généré. Vos données sont conservées. Réessayez.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <div>
    <Button variant="secondary" disabled={!loaded || !!storageError || busy} onClick={download}>
      <Download className="h-4 w-4" aria-hidden="true" />
      {busy ? "Génération du PDF…" : "Exporter en PDF"}
    </Button>
    {error && <p role="alert" className="mt-2 text-sm text-watch">{error}</p>}
  </div>;
}
