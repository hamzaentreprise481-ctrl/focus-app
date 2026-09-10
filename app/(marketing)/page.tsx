import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  UserCheck,
  Eye,
  LockKeyhole,
  ChevronRight,
  Check,
} from "lucide-react";
import { marketingDemo as demo } from "@/lib/demo/marketing-data";
import styles from "./page.module.css";

function demoRequestUrl() {
  const value = process.env.FOCUS_DEMO_REQUEST_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
function ProductPreview() {
  return (
    <figure
      className={styles.productFrame}
      id="apercu"
      aria-label="Aperçu fictif de l’espace professeur"
    >
      <figcaption className={styles.frameTop}>
        <span />
        <span />
        <span />
        <p>Données fictives de démonstration</p>
      </figcaption>
      <div className={styles.productBody}>
        <aside className={styles.previewNav} aria-hidden="true">
          <strong className={styles.brand}>
            <span className={styles.mark}>F</span>FOCUS
          </strong>
          <span className={styles.previewNavActive}>Accueil</span>
          <span>Mes classes</span>
          <span>Mes élèves</span>
          <span>Évaluations</span>
        </aside>
        <div className={styles.previewMain}>
          <div className={styles.previewHeading}>
            <div>
              <small>
                {demo.className} · {demo.subject}
              </small>
              <h3>Bonjour {demo.teacher}.</h3>
              <p>Par quoi souhaitez-vous commencer ?</p>
            </div>
            <span className={styles.dataPill}>Espace professeur</span>
          </div>
          <div className={styles.previewActions}>
            <div>
              <BookOpen size={18} />
              <strong>Ouvrir ma classe</strong>
            </div>
            <div>
              <ClipboardList size={18} />
              <strong>Ajouter une évaluation</strong>
            </div>
            <div>
              <UserCheck size={18} />
              <strong>Consulter mes élèves</strong>
            </div>
          </div>
          <div className={styles.previewGrid}>
            <div className={styles.signalList}>
              <div className={styles.previewSectionTitle}>
                <strong>Le fil de votre classe</strong>
              </div>
              {demo.evaluations.map((e) => (
                <div className={styles.signalRow} key={e.name}>
                  <span className={styles.avatar}>
                    <ClipboardList size={15} />
                  </span>
                  <div>
                    <strong>{e.name}</strong>
                    <small>
                      {e.date} · {e.skills} compétences abordées
                    </small>
                  </div>
                  <ChevronRight size={15} />
                </div>
              ))}
            </div>
            <div className={styles.insightPanel}>
              <span className={styles.eyebrow}>À VOTRE RYTHME</span>
              <h4>
                Un peu de recul,
                <br />
                quand vous en avez besoin.
              </h4>
              <p>
                Les observations restent accessibles. Vous choisissez quand les
                approfondir.
              </p>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
const questions = [
  [
    "FOCUS remplace-t-il PRONOTE ou ÉcoleDirecte ?",
    "Non. Les outils de vie scolaire restent en place pour les emplois du temps, les absences, la discipline, les notes officielles et la communication administrative. FOCUS apporte une lecture complémentaire des apprentissages.",
  ],
  [
    "Faut-il changer ma façon d’évaluer ?",
    "FOCUS distingue les résultats globaux et les compétences que vous renseignez. Une note ne suffit pas à déduire la maîtrise d’une compétence : en l’absence d’observations, le manque de données reste visible.",
  ],
  [
    "FOCUS prend-il des décisions sur les élèves ?",
    "Non. Les analyses sont des pistes à confirmer avec votre connaissance de la classe. FOCUS ne prédit pas le décrochage et ne remplace aucune décision pédagogique.",
  ],
  [
    "Que peut-on essayer aujourd’hui ?",
    "L’espace professeur présente une classe fictive, ses évaluations, des profils et des pistes d’accompagnement. Les ajouts d’évaluations restent sur l’appareil. Les accompagnements sont simulés ; la mesure de leur effet et les connexions aux outils scolaires restent à développer.",
  ],
  [
    "Les élèves et les parents peuvent-ils se connecter ici ?",
    "Non. Ce site donne accès uniquement à FOCUS Teacher. FOCUS Student et FOCUS Parent sont prévus comme deux applications distinctes ; ils ne sont pas disponibles ici.",
  ],
  [
    "Peut-on déjà importer des données réelles d’élèves ?",
    "Pas dans cette version de démonstration. Le stockage métier sécurisé, les droits par établissement et les modalités de conservation doivent être mis en place et vérifiés avant tout usage avec des données réelles.",
  ],
];
export default function PresentationPage() {
  const requestUrl = demoRequestUrl();
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.container}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>
              <span /> Au service du regard enseignant
            </span>
            <h1>
              Mieux suivre chaque élève,<em>sans alourdir le quotidien.</em>
            </h1>
            <p>
              Reliez les observations, comprenez les progrès et rendez les
              difficultés persistantes plus visibles. FOCUS vous aide à choisir
              la suite, en gardant la main.
            </p>
            <div className={styles.heroActions}>
              <a href="#contact" className={styles.primaryButton}>
                Demander une démonstration <ArrowRight size={17} />
              </a>
              <a href="#apercu" className={styles.secondaryButton}>
                Découvrir l’espace professeur
              </a>
            </div>
            <p className={styles.heroTrust}>
              En complément de vos outils de vie scolaire.
            </p>
          </div>
          <ProductPreview />
        </div>
      </section>
      <section className={styles.problem} id="difference">
        <div className={styles.narrow}>
          <span className={styles.sectionLabel}>LE TEMPS DE COMPRENDRE</span>
          <h2>
            Derrière un résultat,
            <br />
            il y a un apprentissage.
          </h2>
          <p>
            Une note isolée ne raconte pas toute l’histoire. Croiser les
            observations dans le temps aide à distinguer un passage difficile,
            une notion à reprendre ou un progrès à encourager.
          </p>
        </div>
        <div className={`${styles.container} ${styles.compare}`}>
          <article className={styles.oldWay}>
            <span className={styles.cardLabel}>VOS OUTILS DE VIE SCOLAIRE</span>
            <h3>Le quotidien de l’établissement.</h3>
            <ul>
              <li>
                <Check size={16} /> Emploi du temps, assiduité et discipline
              </li>
              <li>
                <Check size={16} /> Notes officielles et administration
              </li>
              <li>
                <Check size={16} /> Communication administrative
              </li>
            </ul>
          </article>
          <div className={styles.versus}>+</div>
          <article className={styles.focusWay}>
            <span className={styles.cardLabel}>FOCUS, EN COMPLÉMENT</span>
            <h3>Une lecture des apprentissages.</h3>
            <ul>
              <li>
                <Check size={16} /> Évolution et compétences observées
              </li>
              <li>
                <Check size={16} /> Difficultés persistantes contextualisées
              </li>
              <li>
                <Check size={16} /> Pistes pour un suivi personnalisé
              </li>
            </ul>
          </article>
        </div>
        <p className={styles.integrationNote}>
          FOCUS complète PRONOTE, ÉcoleDirecte et les ENT. Aucune
          synchronisation automatique n’est disponible dans cette version.
        </p>
      </section>
      <section className={styles.how} id="fonctionnement">
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionLabel}>UN PARCOURS SIMPLE</span>
            <h2>
              Observer. Comprendre.
              <br />
              Choisir la suite.
            </h2>
            <p>
              Un espace pour préparer vos prochaines décisions pédagogiques,
              sans multiplier les informations à l’écran.
            </p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <h3>Retrouvez votre classe</h3>
              <p>
                Accédez aux élèves et aux dernières évaluations depuis un
                accueil calme.
              </p>
            </li>
            <li>
              <span>02</span>
              <h3>Relisez les observations</h3>
              <p>
                Suivez l’évolution, les points à travailler et les limites des
                données disponibles.
              </p>
            </li>
            <li>
              <span>03</span>
              <h3>Décidez de l’action utile</h3>
              <p>
                Choisissez une piste, adaptez-la à l’élève. Le suivi de son
                effet fait partie des prochaines étapes du produit.
              </p>
            </li>
          </ol>
          <div className={styles.observation}>
            <div>
              <span className={styles.sectionLabel}>UN SIGNAL EXPLIQUÉ</span>
              <h3>{demo.observation.skill}</h3>
              <p>{demo.observation.context}</p>
            </div>
            <div>
              <span className={styles.proofStrong}>
                {demo.observation.reliability}
              </span>
              <p>
                Basé sur {demo.observation.observations} évaluations cohérentes
              </p>
              <strong>
                Piste possible : {demo.observation.action.toLowerCase()}.
              </strong>
              <small>
                {demo.observation.name} · Données fictives de démonstration
              </small>
            </div>
          </div>
          <div className={styles.ecosystem}>
            <h3>Trois espaces, trois usages distincts.</h3>
            <p>
              <strong>FOCUS Teacher</strong> pour les enseignants aujourd’hui.{" "}
              <strong>FOCUS Student</strong> et <strong>FOCUS Parent</strong>{" "}
              sont prévus dans des applications séparées.
            </p>
            <Link href="/connexion">
              Accéder à l’espace professeur <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
      <section className={styles.trust} id="confiance">
        <div className={styles.container}>
          <div className={styles.trustCopy}>
            <span className={styles.sectionLabel}>NOTRE APPROCHE</span>
            <h2>
              Votre jugement
              <br />
              reste essentiel.
            </h2>
            <p>
              Conçu avec la protection des données comme exigence. Les limites
              du produit doivent être aussi lisibles que ses analyses.
            </p>
          </div>
          <div className={styles.trustItems}>
            <article>
              <UserCheck />
              <div>
                <h3>Une aide à la réflexion</h3>
                <p>
                  Les pistes proposées se discutent et s’adaptent. Vous décidez
                  de l’accompagnement.
                </p>
              </div>
            </article>
            <article>
              <Eye />
              <div>
                <h3>Des incertitudes explicites</h3>
                <p>
                  Le nombre et la cohérence des observations donnent du
                  contexte. Un signal n’est pas une certitude.
                </p>
              </div>
            </article>
            <article>
              <LockKeyhole />
              <div>
                <h3>Des engagements à vérifier</h3>
                <p>
                  Cette démonstration utilise uniquement des données fictives.
                  L’isolation des établissements et la conformité doivent être
                  vérifiées avant un usage réel ; elles ne sont pas revendiquées
                  aujourd’hui.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>
      <section id="faq" className={styles.faq}>
        <div className={styles.narrow}>
          <span className={styles.sectionLabel}>POUR Y VOIR CLAIR</span>
          <h2>Vos questions, simplement.</h2>
          {questions.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className={styles.cta} id="contact">
        <div className={styles.narrow}>
          <span className={styles.sectionLabel}>PARLONS DE VOTRE USAGE</span>
          <h2>
            À quoi ressemblerait
            <br />
            le suivi dans votre classe ?
          </h2>
          <p>
            Une démonstration pour explorer le parcours professeur et discuter
            des besoins de votre établissement.
          </p>
          {requestUrl ? (
            <a href={requestUrl} className={styles.lightButton}>
              Demander une démonstration <ArrowRight size={17} />
            </a>
          ) : (
            <>
              <a href="#apercu" className={styles.lightButton}>
                Voir l’aperçu de démonstration <ArrowRight size={17} />
              </a>
              <small>
                Les demandes de démonstration ne sont pas encore ouvertes.
                Aucune demande n’est enregistrée sur ce site.
              </small>
            </>
          )}
          <Link href="/connexion" className={styles.loginFooter}>
            Vous avez déjà un compte ? Espace professeur →
          </Link>
        </div>
      </section>
    </>
  );
}
