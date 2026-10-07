import Link from "next/link";
import { ArrowRight, Eye, LockKeyhole, ShieldCheck, UserCheck } from "lucide-react";
import styles from "../page.module.css";

export default function TrustPage() {
  return (
    <>
      <section className={styles.pageHero}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>CONFIANCE</p>
          <h1>Une IA utile seulement si ses limites restent visibles.</h1>
          <p className={styles.pageLead}>FOCUS est conçu pour éviter deux erreurs : faire passer une hypothèse pour un fait, et faire croire qu’un score suffit à comprendre un élève.</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.infoGrid}>
            <article><Eye /><h3>Preuves visibles</h3><p>L’interprétation renvoie à la réponse concernée et à la notion travaillée. Le professeur peut vérifier la base de la proposition.</p></article>
            <article><UserCheck /><h3>Validation humaine</h3><p>Une difficulté proposée ne devient une observation confirmée qu’après décision du professeur.</p></article>
            <article><ShieldCheck /><h3>Incertitude explicite</h3><p>Un manque de données doit produire « preuves insuffisantes », pas une conclusion rassurante ou définitive.</p></article>
            <article><LockKeyhole /><h3>Accès encadrés</h3><p>Les espaces professeur sont réservés aux comptes autorisés. L’isolation des établissements fait partie des points à contrôler avant usage réel.</p></article>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.softSection}`}>
        <div className={`${styles.container} ${styles.trustGrid}`}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>CE QUE NOUS NE PRÉTENDONS PAS</p>
            <h2>Une démo propre n’est pas encore une preuve de production.</h2>
            <p>Avant de traiter des données réelles d’élèves, l’établissement doit vérifier le cadre contractuel, la conservation des données, les droits d’accès, l’hébergement et la conformité applicable.</p>
          </div>
          <div className={styles.callout}>
            <strong>Principe produit</strong>
            <p>FOCUS doit pouvoir dire « je ne sais pas » lorsqu’il n’a pas assez de preuves. Cette réponse est préférable à une analyse artificiellement précise.</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>AVANT UN PILOTE RÉEL</p>
          <h2>Ce qu’il faut tester avant d’y croire vraiment.</h2>
          <ul className={styles.plainList}>
            <li>Taux de propositions réellement utiles après relecture du professeur.</li>
            <li>Taux d’hypothèses rejetées ou corrigées.</li>
            <li>Temps gagné ou perdu sur une évaluation complète.</li>
            <li>Robustesse des droits d’accès entre établissements et utilisateurs.</li>
            <li>Qualité du suivi quand les preuves sont faibles ou contradictoires.</li>
          </ul>
          <Link href="/questions" className={styles.textLink}>Lire les questions fréquentes <ArrowRight size={16} /></Link>
        </div>
      </section>
    </>
  );
}
