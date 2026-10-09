import { loadDirectorData } from "@/lib/director-data";

export default async function DirectorClassesPage() {
  const { classes } = await loadDirectorData();
  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">PILOTAGE</p>
        <h1 className="mt-2 text-3xl font-semibold">Classes</h1>
        <p className="mt-3 text-ink-soft">Indicateurs descriptifs de chaque classe, sans déduire un jugement automatique sur le professeur.</p>
      </header>
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-paper text-ink-soft">
            <tr>
              <th className="p-4 font-medium">Classe</th><th className="p-4 font-medium">Élèves</th>
              <th className="p-4 font-medium">Évaluations</th><th className="p-4 font-medium">Séances</th>
              <th className="p-4 font-medium">Résultats notés</th><th className="p-4 font-medium">Moyenne observée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {classes.map((row) => (
              <tr key={row.id}>
                <td className="p-4 font-medium">{row.name}<span className="block text-xs font-normal text-ink-soft">{row.level ?? "Niveau non renseigné"}</span></td>
                <td className="p-4">{row.students}</td><td className="p-4">{row.assessments}</td>
                <td className="p-4">{row.lessons}</td><td className="p-4">{row.gradedResults}</td>
                <td className="p-4 font-semibold">{row.average === null ? "—" : row.average.toFixed(1) + "/20"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
