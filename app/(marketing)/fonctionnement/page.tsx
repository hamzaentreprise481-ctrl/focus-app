import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import styles from "../page.module.css";

const steps = [
  ["01", "Préparer l’évaluation", "Le professeur renseigne le sujet, le corrigé, les questions, le barème et les notions réellement évaluées."],
  ["02", "Ajouter les réponses", "Les réponses de l’élève sont associées aux bonnes questions. La V1 privilégie la preuve textuelle plutôt qu’une note isolée."],
  ["03", "Lancer l’analyse", "FOCUS rapproche la réponse, le corrigé et les notions afin de proposer une interprétation pédagogique traçable."],
  ["04", "Vérifier les preuves", "Le professeur voit l’extrait concerné, la notion, le niveau de preuve et les éventuelles limites de l’analyse."],
  ["05", "Confirmer ou écarter", "Seules les observations confirmées alimentent le suivi de l’élève. Une proposition rejetée reste distinguée."],
  ["06", "Suivre dans le temps", "Les observations confirmées sont replacées dans l’historique afin de repérer progrès, répétitions et points à retravailler."],
];

export default function HowItWorksPage() {
  return (
    <>
      <section className={styles.pageHero}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>FONCTIONNEMENT</p>
          <h1>De l’évaluation à une décision pédagogique plus documentée.</h1>
          <p className={styles.pageLead}>FOCUS n’est pas un chatbot auquel on demande « que penser de cet élève ? ». Le parcours part de preuves, structure l’analyse puis redonne la décision au professeur.</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.softSection}`}>
        <div className={styles.container}>
          <ol className={styles.detailedSteps}>
            {steps.map(([number, title, description]) => (
              <li key={number}>
                <span>{number}</span>
                <div><h2>{title}</h2><p>{description}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>CE QUE LE PROFESSEUR GARDE</p>
            <h2>La maîtrise du raisonnement et de la décision.</h2>
          </div>
          <ul className={styles.checkGrid}>
            {[
              "Le choix des notions évaluées.",
              "La lecture finale de la copie.",
              "La confirmation ou le rejet d’une hypothèse.",
              "La décision de remédiation ou d’approfondissement.",
              "Le moment où une observation doit être reconsidérée.",
              "La responsabilité de l’évaluation officielle.",
            ].map((item) => <li key={item}><CheckCircle2 size={18} />{item}</li>)}
          </ul>
          <Link href="/confiance" className={styles.textLink}>Voir les garde-fous de l’analyse <ArrowRight size={16} /></Link>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>ÉTAPE SUIVANTE</p>
          <h2>Découvrir l’offre prévue pour les établissements.</h2>
          <p>La tarification reste simple : commencer petit, mesurer l’usage, puis étendre seulement si le produit est utile.</p>
          <Link href="/abonnements" className={styles.lightButton}>Voir les abonnements <ArrowRight size={17} /></Link>
        </div>
      </section>
    </>
  );
}
