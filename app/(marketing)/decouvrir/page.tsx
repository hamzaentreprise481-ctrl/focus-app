import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardCheck, GraduationCap, Layers3, ShieldCheck, Users } from "lucide-react";
import styles from "../page.module.css";

export default function DiscoverPage() {
  return (
    <>
      <section className={styles.pageHero}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>DÉCOUVRIR FOCUS</p>
          <h1>Un espace de travail pour comprendre ce que les élèves savent vraiment faire.</h1>
          <p className={styles.pageLead}>
            FOCUS complète les notes avec les réponses, les notions travaillées et les observations confirmées par le professeur.
            L’objectif n’est pas d’ajouter un tableau de bord de plus, mais de rendre le suivi pédagogique plus lisible.
          </p>
          <div className={styles.heroActions}>
            <Link href="/fonctionnement" className={styles.primaryButton}>Voir le fonctionnement <ArrowRight size={17} /></Link>
            <Link href="/abonnements" className={styles.secondaryButton}>Voir les abonnements</Link>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>CE QUE FOCUS AJOUTE</p>
            <h2>Le résultat, le contexte et la prochaine décision au même endroit.</h2>
          </div>
          <div className={styles.infoGrid}>
            <article><ClipboardCheck /><h3>Évaluations structurées</h3><p>Sujet, corrigé, questions, réponses et notions restent reliés au même dossier.</p></article>
            <article><BookOpen /><h3>Lecture pédagogique</h3><p>Les difficultés proposées renvoient à des éléments observables, plutôt qu’à une conclusion opaque.</p></article>
            <article><Users /><h3>Suivi individuel</h3><p>Chaque élève conserve un historique de ses observations confirmées au fil des évaluations.</p></article>
            <article><Layers3 /><h3>Vision de classe</h3><p>Les tendances communes aident à repérer les notions qui méritent une reprise collective.</p></article>
            <article><ShieldCheck /><h3>Contrôle enseignant</h3><p>Une proposition n’est pas transformée en vérité : le professeur confirme, écarte ou demande davantage de preuves.</p></article>
            <article><GraduationCap /><h3>Écosystème séparé</h3><p>FOCUS Teacher est l’espace actuel. Les futurs espaces Student et Parent resteront distincts.</p></article>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.softSection}`}>
        <div className={styles.container}>
          <div className={styles.trustGrid}>
            <div className={styles.sectionIntro}>
              <p className={styles.sectionLabel}>POUR QUI ?</p>
              <h2>Conçu d’abord pour le professeur et l’établissement.</h2>
              <p>FOCUS vise les équipes qui veulent mieux exploiter les copies et les évaluations sans remplacer leur ENT ou leur logiciel de vie scolaire.</p>
            </div>
            <div className={styles.callout}>
              <strong>Version actuelle</strong>
              <p>Le parcours prioritaire concerne FOCUS Teacher et les mathématiques. Les autres matières et espaces seront étendus après validation du pilote.</p>
              <Link href="/confiance">Voir ce qui est déjà fiable et ce qui reste à valider <ArrowRight size={16} /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>ALLER PLUS LOIN</p>
          <h2>Voir comment FOCUS s’intègre dans une journée de professeur.</h2>
          <p>Le parcours détaillé montre ce qui se passe avant, pendant et après l’analyse d’une évaluation.</p>
          <Link href="/fonctionnement" className={styles.lightButton}>Découvrir le parcours <ArrowRight size={17} /></Link>
        </div>
      </section>
    </>
  );
}
