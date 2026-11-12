import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  GraduationCap,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import styles from "./page.module.css";

export const metadata = {
  title: "FOCUS · Suivi pédagogique",
  description:
    "FOCUS transforme les données de classe en accompagnement personnalisé : un espace pour les professeurs, les élèves et la direction.",
};

const spaces = [
  {
    id: "teacher",
    label: "Professeur",
    product: "FOCUS Teacher",
    text: "Suivre ses classes, ses évaluations et les besoins pédagogiques de ses élèves.",
    action: "Accéder à Teacher",
    href: "/connexion",
    icon: UserRound,
    eyebrow: "Agir",
  },
  {
    id: "student",
    label: "Élève",
    product: "FOCUS Student",
    text: "Comprendre ses résultats, suivre sa progression et obtenir de l’aide.",
    action: "Accéder à Student",
    href: "/connexion-eleve",
    icon: GraduationCap,
    eyebrow: "Comprendre",
  },
  {
    id: "director",
    label: "Direction",
    product: "FOCUS Direction",
    text: "Suivre l’avancement pédagogique de l’établissement et identifier les points de vigilance.",
    action: "Accéder à Director",
    href: "/connexion-direction",
    icon: Building2,
    eyebrow: "Piloter",
  },
] as const;

export default function PortalPage() {
  return (
    <>
      <section className={styles.portalHero}>
        <div className={`${styles.container} ${styles.portalHeroGrid}`}>
          <div className={styles.portalHeroCopy}>
            <p className={styles.portalEyebrow}>
              <span>FOCUS</span>
              Une plateforme pédagogique, trois espaces
            </p>
            <h1>
              Les bonnes informations,
              <span> au bon moment.</span>
            </h1>
            <p className={styles.portalLead}>
              FOCUS transforme les évaluations et le suivi de classe en une
              lecture claire pour le professeur, l’élève et la direction —
              sans retirer la décision pédagogique à l’enseignant.
            </p>
            <div className={styles.portalHeroActions}>
              <Link href="#espaces" className={styles.primaryButton}>
                Choisir mon espace <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link href="/enseignants" className={styles.secondaryButton}>
                Découvrir FOCUS Teacher
              </Link>
            </div>
            <div className={styles.portalTrustRow}>
              <span><ShieldCheck size={16} aria-hidden="true" /> Données cloisonnées par rôle</span>
              <span><BookOpenCheck size={16} aria-hidden="true" /> Décision professeur préservée</span>
            </div>
          </div>

          <aside className={styles.portalSignalPanel} aria-label="Aperçu de la plateforme FOCUS">
            <div className={styles.portalSignalTop}>
              <span className={styles.portalSignalMark}>F</span>
              <div>
                <strong>FOCUS</strong>
                <small>Vue pédagogique partagée</small>
              </div>
              <span className={styles.portalLive}>V1</span>
            </div>
            <div className={styles.portalSignalBody}>
              <p className={styles.portalSignalLabel}>Une même donnée, trois usages</p>
              <div className={styles.portalSignalList}>
                <div>
                  <span className={styles.signalIcon}><UserRound size={17} aria-hidden="true" /></span>
                  <span><strong>Teacher</strong><small>Décider et accompagner</small></span>
                  <span className={styles.signalStatus}>À traiter</span>
                </div>
                <div>
                  <span className={styles.signalIcon}><GraduationCap size={17} aria-hidden="true" /></span>
                  <span><strong>Student</strong><small>Comprendre et progresser</small></span>
                  <span className={styles.signalStatus}>Progression</span>
                </div>
                <div>
                  <span className={styles.signalIcon}><Building2 size={17} aria-hidden="true" /></span>
                  <span><strong>Direction</strong><small>Piloter sans classer</small></span>
                  <span className={styles.signalStatus}>Vue globale</span>
                </div>
              </div>
              <div className={styles.portalSignalFooter}>
                <Sparkles size={17} aria-hidden="true" />
                <p>
                  L’IA aide à expliquer et à repérer. Les données officielles et
                  les décisions restent maîtrisées par l’établissement.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section
        id="espaces"
        aria-labelledby="espaces-title"
        className={styles.portalSection}
      >
        <div className={styles.container}>
          <div className={styles.portalSectionHead}>
            <div>
              <p className={styles.sectionLabel}>ACCÈS</p>
              <h2 id="espaces-title" className={styles.portalTitle}>
                Un espace conçu pour chaque rôle
              </h2>
            </div>
            <p>
              Même établissement, mêmes preuves, mais uniquement les informations
              et les actions utiles à votre rôle.
            </p>
          </div>

          <ul className={styles.portalGrid}>
            {spaces.map(({ id, label, product, text, action, href, icon: Icon, eyebrow }) => (
              <li key={id} className={styles.portalCard} data-space={id}>
                <div className={styles.portalCardHead}>
                  <span className={styles.portalIconWrap}>
                    <Icon size={21} aria-hidden="true" className={styles.portalIcon} />
                  </span>
                  <span className={styles.portalCardEyebrow}>{eyebrow}</span>
                </div>
                <h3>{label}</h3>
                <p className={styles.portalProduct}>{product}</p>
                <p className={styles.portalText}>{text}</p>
                <Link href={href} className={styles.portalCardAction}>
                  {action} <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>

          <div className={styles.portalBottomNote}>
            <ShieldCheck size={18} aria-hidden="true" />
            <p>
              Chaque espace possède sa propre connexion et ses propres
              autorisations. Les comptes sont créés par l’établissement ; il
              n’y a pas d’inscription libre.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
