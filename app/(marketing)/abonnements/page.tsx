import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import styles from "../page.module.css";

const subscribeHref = "mailto:hamzaentreprise481@gmail.com?subject=FOCUS%20%E2%80%94%20Demande%20d%27abonnement&body=Bonjour%2C%0A%0AJe%20souhaite%20%C3%A9changer%20sur%20un%20abonnement%20FOCUS.%0A%C3%89tablissement%20%3A%0ANombre%20de%20professeurs%20%3A%0AFormule%20envisag%C3%A9e%20%3A%0A";

const plans = [
  {
    name: "Pilote",
    price: "199 €",
    suffix: "/ mois",
    note: "Pendant 3 mois maximum",
    features: [
      "1 professeur référent",
      "1 classe pilote",
      "Mathématiques",
      "Accompagnement au démarrage",
      "Mesure du temps, des usages et des retours",
    ],
  },
  {
    name: "Établissement",
    price: "499 €",
    suffix: "/ mois",
    note: "Prix cible par établissement",
    featured: true,
    features: [
      "Plusieurs professeurs et plusieurs classes",
      "Suivi individuel des élèves et vision classe",
      "Analyses pédagogiques fondées sur les preuves disponibles",
      "Historique et continuité du suivi",
      "Exports pour le travail pédagogique",
      "Accompagnement et support établissement",
    ],
  },
  {
    name: "Réseau",
    price: "Sur devis",
    suffix: "",
    note: "Pour plusieurs établissements",
    features: [
      "Déploiement multi-établissements",
      "Administration centralisée",
      "Accompagnement dédié",
      "Conditions contractuelles adaptées",
      "Suivi de déploiement",
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <section className={styles.pageHero}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>ABONNEMENTS</p>
          <h1>Une tarification établissement, avec une vraie phase pilote.</h1>
          <p className={styles.pageLead}>
            FOCUS n’est pas vendu comme un abonnement individuel par professeur ou par élève. L’offre principale est pensée à l’échelle de l’établissement, avec une formule pilote limitée pour mesurer l’usage avant un déploiement plus large. Le paiement en ligne n’est pas encore ouvert : la souscription passe d’abord par un échange avec l’établissement.
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.pricingGrid}>
            {plans.map((plan) => (
              <article key={plan.name} className={plan.featured ? styles.featuredPricing : styles.pricingCard}>
                {plan.featured && <span className={styles.priceBadge}>OFFRE PRINCIPALE</span>}
                <h2>{plan.name}</h2>
                <p className={styles.price}><strong>{plan.price}</strong> <span>{plan.suffix}</span></p>
                <p className={styles.priceNote}>{plan.note}</p>
                <ul className={styles.featureList}>
                  {plan.features.map((feature) => <li key={feature}><Check size={17} />{feature}</li>)}
                </ul>
                <a href={subscribeHref} className={plan.featured ? styles.primaryButton : styles.secondaryButton}>
                  Demander cette formule <ArrowRight size={16} />
                </a>
              </article>
            ))}
          </div>
          <p className={styles.integrationNote}>
            Tarifs indicatifs de lancement, hors éventuelles prestations spécifiques d’intégration. Les conditions définitives, le périmètre de données et les engagements de service devront être contractualisés avant tout usage réel.
          </p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.softSection}`}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>POURQUOI 499 € / MOIS ?</p>
          <h2>Un prix pour l’établissement, pas une addition par élève.</h2>
          <p className={styles.pageLead}>
            L’objectif est que FOCUS devienne un outil de travail pédagogique partagé, pas une succession de petits abonnements individuels. À 499 € par mois, l’offre principale correspond à un déploiement établissement avec plusieurs professeurs, plusieurs classes, du suivi dans le temps et un accompagnement identifié. La formule pilote reste volontairement plus accessible afin de vérifier la valeur réelle avant généralisation.
          </p>
          <Link href="/decouvrir" className={styles.textLink}>Revoir ce qui est inclus dans FOCUS <ArrowRight size={16} /></Link>
        </div>
      </section>
    </>
  );
}
