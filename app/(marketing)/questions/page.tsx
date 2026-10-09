import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "../page.module.css";

const questions = [
  ["FOCUS remplace-t-il PRONOTE, ÉcoleDirecte ou un ENT ?", "Non. FOCUS complète les outils de vie scolaire. Les notes officielles, absences, emplois du temps et communications administratives restent gérés par les outils déjà en place."],
  ["FOCUS décide-t-il qu’un élève maîtrise ou non une notion ?", "Non. L’analyse propose des interprétations à partir de preuves. Le professeur garde la décision et peut confirmer ou écarter une hypothèse."],
  ["Que se passe-t-il si les preuves sont insuffisantes ?", "FOCUS doit le signaler explicitement. L’absence d’erreur visible n’est pas transformée automatiquement en preuve de maîtrise."],
  ["Quelles matières sont disponibles ?", "Le parcours d’analyse prioritaire actuel concerne les mathématiques. Les autres matières doivent être ajoutées progressivement après validation du modèle pédagogique."],
  ["Les élèves et parents ont-ils un compte ?", "Pas dans FOCUS Teacher. Les futurs espaces Student et Parent sont prévus comme des produits séparés."],
  ["Peut-on importer des données réelles dès maintenant ?", "Un usage réel doit être précédé d’une validation du cadre de données, des accès, de l’hébergement, de la conservation et des obligations applicables à l’établissement."],
  ["Combien coûte FOCUS ?", "L’offre établissement est positionnée à 149 € par mois pendant cette phase de lancement. Une formule pilote et une offre réseau sont également prévues."],
  ["Peut-on payer directement en ligne ?", "Pas encore. La page Abonnements permet de choisir une formule et de lancer une demande. Le paiement et le contrat sont finalisés après échange avec l’établissement."],
];

export default function QuestionsPage() {
  return (
    <>
      <section className={styles.pageHero}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>QUESTIONS</p>
          <h1>Les réponses importantes avant de présenter FOCUS à un établissement.</h1>
          <p className={styles.pageLead}>Les limites sont aussi importantes que les fonctionnalités. Cette page évite de transformer une promesse produit en affirmation non vérifiée.</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.narrow}>
          <div className={styles.faq}>
            {questions.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
          <div className={styles.heroActions}>
            <Link href="/abonnements" className={styles.primaryButton}>Voir les abonnements <ArrowRight size={16} /></Link>
            <Link href="/confiance" className={styles.secondaryButton}>Voir la page Confiance</Link>
          </div>
        </div>
      </section>
    </>
  );
}
