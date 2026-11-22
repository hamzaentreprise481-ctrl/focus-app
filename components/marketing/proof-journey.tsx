import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileSearch,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import styles from "./proof-journey.module.css";

const stages = [
  {
    number: "01",
    icon: ScanLine,
    title: "Partir de la copie",
    text: "Importer ou saisir les réponses et relier chaque observation à une question.",
  },
  {
    number: "02",
    icon: FileSearch,
    title: "Voir ce qui est démontré",
    text: "Repérer une erreur possible avec un extrait précis, sans inventer de diagnostic.",
  },
  {
    number: "03",
    icon: CheckCircle2,
    title: "Laisser décider le professeur",
    text: "Valider, écarter ou compléter l'hypothèse avant tout suivi pédagogique.",
  },
] as const;

/**
 * Public illustration only. No student data, model output or account access.
 * It must never be presented as a real AI analysis or a real pupil's answer.
 */
export function ProofJourney() {
  return (
    <section aria-labelledby="proof-journey-title" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.heading}>
          <div>
            <p className={styles.kicker}>DU TRAVAIL DE L'ÉLÈVE À L'ACTION</p>
            <h2 id="proof-journey-title">Comprendre une erreur, pas seulement une note.</h2>
          </div>
          <p>
            FOCUS aide à relier les réponses aux compétences travaillées. Les
            hypothèses de l'IA restent des propositions que l'enseignant vérifie.
          </p>
        </div>

        <ol className={styles.stages}>
          {stages.map(({ number, icon: Icon, title, text }) => (
            <li key={number}>
              <div className={styles.stageTop}>
                <span className={styles.stageIcon}><Icon size={19} aria-hidden="true" /></span>
                <span className={styles.stageNumber}>{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>

        <div className={styles.example} aria-label="Démonstration fictive d'une analyse de copie de mathématiques">
          <div className={styles.exampleHeader}>
            <span><BookOpenCheck size={17} aria-hidden="true" /> Illustration pédagogique</span>
            <span className={styles.fakeNotice}>Exemple fictif · Mathématiques</span>
          </div>
          <div className={styles.exampleGrid}>
            <article className={styles.paper}>
              <p className={styles.panelLabel}>01 / RÉPONSE DE L'ÉLÈVE</p>
              <p className={styles.question}>Développer : 2(x + 3)</p>
              <p className={styles.studentAnswer}>2(x + 3) = 2x + <mark>3</mark></p>
              <p className={styles.studentNote}>Extrait fictif illustrant une erreur de distributivité.</p>
            </article>
            <div className={styles.flowArrow} aria-hidden="true"><ArrowRight size={23} /></div>
            <article className={styles.analysis}>
              <p className={styles.panelLabel}>02 / HYPOTHÈSE À EXAMINER</p>
              <h3>Le terme constant n'est pas multiplié par 2.</h3>
              <p>Indice : « 2x + 3 » au lieu de « 2x + 6 ».</p>
              <div className={styles.review}>
                <ShieldCheck size={19} aria-hidden="true" />
                <div>
                  <strong>Validation de l'enseignant nécessaire</strong>
                  <span>Une piste de remédiation ne remplace pas son jugement.</span>
                </div>
              </div>
            </article>
          </div>
        </div>

        <div className={styles.foot}>
          <span>Un exemple pour comprendre le parcours, pas une analyse d'élève réel.</span>
          <Link href="/enseignants">Découvrir FOCUS Teacher <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}
