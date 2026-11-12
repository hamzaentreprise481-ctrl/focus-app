import Link from "next/link";
import { AlertTriangle, Database } from "lucide-react";
import { requireDirector } from "@/lib/auth/server";
import { loadDirectorWorkspace, type DirectorAlert } from "@/lib/director/data";
import { EmptyNote, PageIntro, SectionTitle } from "@/components/director/indicators";

function AlertList({ alerts }: { alerts: DirectorAlert[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-white">
      {alerts.map((alert, index) => (
        <li key={index}>
          <Link href={alert.href} className="flex items-start gap-3 p-4 hover:bg-paper">
            {alert.family === "risk" ? (
              <AlertTriangle size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-watch" />
            ) : (
              <Database size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-soft" />
            )}
            <span className="min-w-0 text-sm">
              <span className="font-medium">{alert.title}</span>
              <span className="mt-0.5 block text-ink-soft">{alert.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DirectorAlertsPage() {
  await requireDirector();
  const workspace = await loadDirectorWorkspace();
  const risk = workspace.alerts.filter((alert) => alert.family === "risk");
  const data = workspace.alerts.filter((alert) => alert.family === "data");

  return (
    <div className="space-y-10">
      <PageIntro title="Alertes">
        Alertes calculées de façon déterministe à partir des données saisies.
        Elles signalent un rythme ou une donnée à vérifier avec l’équipe ;
        elles ne jugent ni un élève ni un enseignant.
      </PageIntro>
      <section aria-labelledby="alertes-rythme">
        <SectionTitle title={`Rythme du programme (${risk.length})`} />
        <h2 id="alertes-rythme" className="sr-only">Rythme du programme</h2>
        {risk.length ? <AlertList alerts={risk} /> : <EmptyNote>Aucun risque de retard ni point de vigilance selon les séances déclarées.</EmptyNote>}
      </section>
      <section aria-labelledby="alertes-donnees">
        <SectionTitle title={`Données manquantes (${data.length})`} />
        <h2 id="alertes-donnees" className="sr-only">Données manquantes</h2>
        {data.length ? <AlertList alerts={data} /> : <EmptyNote>Aucune donnée manquante détectée.</EmptyNote>}
      </section>
    </div>
  );
}
