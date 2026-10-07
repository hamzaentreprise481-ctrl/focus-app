import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import styles from "../page.module.css";

const subscribeHref = "mailto:hamzaentreprise481@gmail.com?subject=FOCUS%20%E2%80%94%20Demande%20d%27abonnement&body=Bonjour%2C%0A%0AJe%20souhaite%20%C3%A9changer%20sur%20un%20abonnement%20FOCUS.%0A%C3%89tablissement%20%3A%0ANombre%20de%20professeurs%20%3A%0AFormule%20envisag%C3%A9e%20%3A%0A";

const plans = [
  {
    name: "Pilote",
    price: "99 €",
    suffix: "/ mois",
    note: "Pendant 3 mois maximum",
    features: ["1 professeur", "1 classe", "Mathématiques", "Accompagnement au démarrage", "Mesure du temps et des usages"],
  },
  {
    name: "Établissement",
    price: "149 €",
    suffix: "/ mois",
    note: "Prix cible par établissement",
    featured: true,
    features: ["Plusieurs professeurs", "Plusieurs classes", "Suivi élève et classe", "Analyses pédagogiques", "Exports et historique", "Support établissement"],
  },
  {
    name: "Réseau",
    price: "Sur devis",
    suffix: "",
    note: "Pour plusieurs établissements",
    features: ["Déploiement multi-établissements", "Administration centralisée", "Accompagnement dédié", "Conditions contractuelles adaptées", "Suivi de déploiement"],
  },
];

export default function PricingPage() {
  return (
    <>
      <section className={styles.pageHero}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>ABONNEMENTS</p>
          <h1>Une tarification simple, pensée pour commencer petit.</h1>
          <p className={styles.pageLead}>Les offres ci-dessous servent de base commerciale pendant la phase pilote. Le paiement en ligne n’est pas encore ouvert : la souscription passe d’abord par un échange avec l’établissement.</p>
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
          <p className={styles.integrationNote}>Tarifs indicatifs de lancement, hors éventuelles prestations spécifiques d’intégration. Les conditions définitives devront être contractualisées avant usage réel.</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.softSection}`}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>POURQUOI 149 € / MOIS ?</p>
          <h2>Un prix établissement, pas un abonnement par élève.</h2>
          <p className={styles.pageLead}>Le produit est vendu comme outil de travail pédagogique. Le prix doit rester lisible pour un établissement, sans multiplier les micro-facturations ni rendre l’adoption dépendante du nombre exact d’élèves.</p>
          <Link href="/decouvrir" className={styles.textLink}>Revoir ce qui est inclus dans FOCUS <ArrowRight size={16} /></Link>
        </div>
      </section>
    </>
  );
}
