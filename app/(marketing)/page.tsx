import Link from "next/link";
import { ArrowRight, Building2, GraduationCap, UserRound } from "lucide-react";
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
  },
  {
    id: "student",
    label: "Élève",
    product: "FOCUS Student",
    text: "Comprendre ses résultats, suivre sa progression et obtenir de l’aide.",
    action: "Accéder à Student",
    href: "/connexion-eleve",
    icon: GraduationCap,
  },
  {
    id: "director",
    label: "Direction",
    product: "FOCUS Direction",
    text: "Suivre l’avancement pédagogique de l’établissement et identifier les points de vigilance.",
    action: "Accéder à Director",
    href: "/connexion-direction",
    icon: Building2,
  },
] as const;

export default function PortalPage() {
  return (
    <>
      <section className={styles.portalHero}>
        <div className={styles.narrow}>
          <p className={styles.kicker}>FOCUS</p>
          <h1>Transformer les données de classe en accompagnement personnalisé.</h1>
          <ul className={styles.portalPoints}>
            <li>Un suivi pédagogique fondé sur les évaluations et les réponses des élèves.</li>
            <li>La progression de chaque élève, compétence par compétence.</li>
            <li>Un accompagnement des enseignants, qui gardent la décision.</li>
            <li>Une vision d’ensemble pour l’établissement.</li>
          </ul>
          <p className={styles.portalNote}>
            FOCUS complète les outils de vie scolaire (PRONOTE, ÉcoleDirecte,
            ENT), qui restent la référence pour les notes officielles et
            l’administration.
          </p>
        </div>
      </section>
      <section
        id="espaces"
        aria-labelledby="espaces-title"
        className={styles.portalSection}
      >
        <div className={styles.container}>
          <h2 id="espaces-title" className={styles.portalTitle}>
            Choisir son espace
          </h2>
          <ul className={styles.portalGrid}>
            {spaces.map(({ id, label, product, text, action, href, icon: Icon }) => (
              <li key={id} className={styles.portalCard}>
                <Icon size={22} aria-hidden="true" className={styles.portalIcon} />
                <h3>{label}</h3>
                <p className={styles.portalProduct}>{product}</p>
                <p className={styles.portalText}>{text}</p>
                <Link href={href} className={styles.primaryButton}>
                  {action} <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className={styles.portalMore}>
            Chaque espace a sa propre connexion et ses propres autorisations.
            Les comptes sont créés par l’établissement ; il n’y a pas
            d’inscription libre.{" "}
            <Link href="/enseignants" className={styles.textLink}>
              Découvrir FOCUS Teacher
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
