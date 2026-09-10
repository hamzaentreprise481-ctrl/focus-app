import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleGauge,
  Eye,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
} from "lucide-react";
import styles from "./page.module.css";
import { analyzeClass, CONFIDENCE_LABEL, getAttentionFeed } from "@/lib/analysis";
import { initials } from "@/lib/utils";

const FLOW = ["Enseigner", "Évaluer", "Détecter", "Intervenir", "Personnaliser", "Mesurer"];

function FocusMark() {
  return (
    <span className={styles.brand} aria-label="FOCUS">
      <span className={styles.mark}>F</span>
      <span>FOCUS</span>
    </span>
  );
}

function ProductPreview() {
  const { counts, studentAnalyses } = analyzeClass("seconde-3");
  const signals = getAttentionFeed("seconde-3", 3);
  const strongEvidenceCount = studentAnalyses.filter(
    (student) => student.weakestSkill?.confidence === "forte"
  ).length;
  const progressingCount = studentAnalyses.filter(
    (student) => student.evolution !== null && student.evolution > 0.3
  ).length;

  return (
    <div className={styles.productFrame} aria-label="Aperçu du tableau de bord enseignant FOCUS">
      <div className={styles.frameTop}>
        <span /><span /><span />
        <p>Tableau de bord enseignant</p>
      </div>
      <div className={styles.productBody}>
        <aside className={styles.previewNav}>
          <FocusMark />
          <span className={styles.previewNavActive}><CircleGauge size={15} /> Vue d&rsquo;ensemble</span>
          <span><UserCheck size={15} /> Élèves</span>
          <span><BarChart3 size={15} /> Évaluations</span>
        </aside>
        <div className={styles.previewMain}>
          <div className={styles.previewHeading}>
            <div><small>SECONDE 3 · MATHÉMATIQUES</small><h3>Où agir cette semaine</h3></div>
            <span className={styles.dataPill}>Données actualisées</span>
          </div>
          <div className={styles.previewStats}>
            <div><span>À examiner</span><strong>{counts.attention + counts.aSurveiller}</strong><small>signaux à relire</small></div>
            <div><span>En progression</span><strong>{progressingCount}</strong><small>trajectoires positives</small></div>
            <div><span>Preuve solide</span><strong>{strongEvidenceCount}</strong><small>compétences documentées</small></div>
          </div>
          <div className={styles.previewGrid}>
            <div className={styles.signalList}>
              <div className={styles.previewSectionTitle}><strong>Signaux à examiner</strong><span>Priorisés</span></div>
              {signals.map((student) => (
                <div className={styles.signalRow} key={student.studentId}>
                  <span className={styles.avatar}>{initials(student.name)}</span>
                  <div><strong>{student.name}</strong><small>{student.summary}</small></div>
                  <span className={student.weakestSkill?.confidence === "forte" ? styles.proofStrong : styles.proof}>
                    {student.weakestSkill ? CONFIDENCE_LABEL[student.weakestSkill.confidence] : "À confirmer"}
                  </span>
                  <ChevronRight size={15} />
                </div>
              ))}
            </div>
            <div className={styles.insightPanel}>
              <span className={styles.eyebrow}><Sparkles size={13} /> LECTURE FOCUS</span>
              <h4>Un signal, son contexte et une action possible.</h4>
              <p>La décision reste entre les mains de l&rsquo;enseignant.</p>
              <div className={styles.actionLine}><Check size={14} /> Vérifier la notion en entretien court</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PresentationPage() {
  return (
    <main className={styles.marketing}>
      <header className={styles.header}>
        <div className={styles.container}>
          <Link href="/decouvrir"><FocusMark /></Link>
          <nav aria-label="Navigation principale">
            <a href="#difference">Pourquoi FOCUS</a><a href="#fonctionnement">Fonctionnement</a><a href="#confiance">Confiance</a>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/" className={styles.textLink}>Voir la démo</Link>
            <a href="#contact" className={styles.smallButton}>Demander une démo</a>
          </div>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.container}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}><span /> Intelligence pédagogique · au service du jugement enseignant</span>
            <h1>Comprendre qui a besoin d&rsquo;aide — <em>avant le décrochage.</em></h1>
            <p>FOCUS transforme les données d&rsquo;apprentissage en signaux lisibles, en pistes d&rsquo;action et en suivi individualisé pour chaque élève.</p>
            <div className={styles.heroActions}>
              <a href="#contact" className={styles.primaryButton}>Demander une démo <ArrowRight size={17} /></a>
              <a href="#fonctionnement" className={styles.secondaryButton}>Voir comment ça fonctionne</a>
            </div>
            <div className={styles.heroTrust}><ShieldCheck size={16} /><span>L&rsquo;enseignant décide. FOCUS éclaire — il ne remplace pas.</span></div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className={styles.problem} id="difference">
        <div className={styles.narrow}>
          <span className={styles.sectionLabel}>LE PROBLÈME</span>
          <h2>Une note montre un résultat.<br />Pas toujours ce qu&rsquo;il faut faire ensuite.</h2>
          <p>Face à 25 ou 35 élèves, repérer une difficulté persistante, la distinguer d&rsquo;un accident et mesurer l&rsquo;effet d&rsquo;une intervention exige une lecture que les outils de suivi classiques ne proposent pas.</p>
        </div>
        <div className={`${styles.container} ${styles.compare}`}>
          <article className={styles.oldWay}>
            <span className={styles.cardLabel}>LOGICIEL SCOLAIRE TRADITIONNEL</span><h3>Consigne ce qui s&rsquo;est passé.</h3>
            <ul><li><Check size={16} /> Notes et absences</li><li><Check size={16} /> Bulletins et moyennes</li><li><Check size={16} /> Vie scolaire</li></ul>
          </article>
          <div className={styles.versus}>puis</div>
          <article className={styles.focusWay}>
            <span className={styles.cardLabel}>FOCUS</span><h3>Aide à décider quoi faire ensuite.</h3>
            <ul><li><Target size={16} /> Signaux contextualisés</li><li><Eye size={16} /> Niveau de preuve explicite</li><li><CircleGauge size={16} /> Effet des interventions suivi</li></ul>
          </article>
        </div>
      </section>

      <section className={styles.how} id="fonctionnement">
        <div className={styles.container}>
          <div className={styles.sectionIntro}><span className={styles.sectionLabel}>UNE BOUCLE PÉDAGOGIQUE CONTINUE</span><h2>Des observations à l&rsquo;action,<br />sans ajouter du bruit.</h2><p>FOCUS organise les informations déjà produites en classe pour rendre les priorités visibles et suivre ce qui aide réellement.</p></div>
          <ol className={styles.flow}>{FLOW.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, "0")}</span><strong>{step}</strong>{i < FLOW.length - 1 && <ArrowRight size={15} />}</li>)}</ol>
          <div className={styles.experienceGrid}>
            <article><span className={styles.iconBox}><Target /></span><small>POUR L&rsquo;ENSEIGNANT</small><h3>Voir les élèves, pas seulement les moyennes.</h3><p>Un tableau de classe lisible, des profils longitudinaux et des signaux expliqués avec leur niveau de preuve.</p><Link href="/">Explorer l&rsquo;interface <ArrowRight size={15} /></Link></article>
            <article><span className={styles.iconBox}><Sparkles /></span><small>POUR L&rsquo;ÉLÈVE · EN DÉVELOPPEMENT</small><h3>Un accompagnement plus personnel.</h3><p>À terme, des activités ciblées par l&rsquo;enseignant et adaptées aux compétences à consolider — sans automatiser les décisions pédagogiques.</p></article>
          </div>
        </div>
      </section>

      <section className={styles.trust} id="confiance">
        <div className={styles.container}>
          <div className={styles.trustCopy}><span className={styles.sectionLabel}>CONFIANCE PAR CONCEPTION</span><h2>Une technologie à sa juste place.</h2><p>FOCUS est conçu pour assister le travail pédagogique, avec des limites visibles et une responsabilité humaine préservée.</p></div>
          <div className={styles.trustItems}>
            <article><UserCheck /><div><h3>Décision humaine</h3><p>Aucune décision à enjeu élevé n&rsquo;est prise automatiquement.</p></div></article>
            <article><LockKeyhole /><div><h3>Isolation des données</h3><p>Une architecture pensée pour séparer les données de chaque établissement.</p></div></article>
            <article><ShieldCheck /><div><h3>Vie privée dès la conception</h3><p>Un développement orienté RGPD, sans revendiquer une conformité non auditée.</p></div></article>
          </div>
        </div>
      </section>

      <section className={styles.cta} id="contact"><div className={styles.narrow}><FocusMark /><h2>Apporter un soutien personnalisé<br />à chaque élève.</h2><p>Découvrez comment FOCUS peut rendre les décisions pédagogiques plus lisibles dans votre établissement.</p><a href="mailto:contact@focus.education" className={styles.lightButton}>Demander une démonstration <ArrowRight size={17} /></a><small>Échange exploratoire · Sans engagement</small></div></section>
      <footer className={styles.footer}><div className={styles.container}><FocusMark /><p>Intelligence pédagogique pour les équipes enseignantes.</p><span>© 2026 FOCUS</span></div></footer>
    </main>
  );
}
