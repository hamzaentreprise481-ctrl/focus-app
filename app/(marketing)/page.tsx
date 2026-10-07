import Link from "next/link";
import { ArrowRight, FileText, UserCheck, ScanText, Check } from "lucide-react";
import styles from "./page.module.css";

function demoRequestUrl() {
  const value = process.env.FOCUS_DEMO_REQUEST_URL;
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:") return url.href;
    } catch {
      /* use the contact fallback */
    }
  }
  return "mailto:hamzaentreprise481@gmail.com?subject=FOCUS%20Teacher%20%E2%80%94%20Demande%20de%20d%C3%A9monstration&body=Bonjour%2C%0A%0AJe%20souhaite%20d%C3%A9couvrir%20FOCUS%20Teacher.%0A%C3%89tablissement%20%3A%0AFonction%20%3A%0ADisponibilit%C3%A9s%20%3A%0A";
}

const questions = [
  [
    "Pourquoi l’utiliser avec PRONOTE ou un ENT ?",
    "Vos outils de vie scolaire restent le point de référence pour les notes officielles et le quotidien de l’établissement. FOCUS organise un autre travail : relier une réponse précise, une notion du programme et une observation contrôlée par le professeur. Aucune synchronisation automatique avec ces outils n’est disponible dans la V1.",
  ],
  [
    "Comment vérifier une interprétation ?",
    "Chaque proposition affiche l’extrait exact de la réponse, la notion concernée et le niveau de preuve. Le professeur confirme ou écarte la proposition. Si la copie ou le corrigé change, l’analyse précédente est remplacée et doit être relancée.",
  ],
  [
    "Le professeur perd-il le contrôle ?",
    "Le professeur garde la décision. Une hypothèse non confirmée reste présentée comme une hypothèse. Une proposition écartée n’entre pas dans les difficultés confirmées. Les exports élèves retiennent les observations confirmées par le professeur.",
  ],
  [
    "Combien de temps cela fait-il gagner ?",
    "Le gain de temps n’est pas encore mesuré. Le pilote doit comparer le temps de saisie, de relecture et de décision à votre méthode actuelle. La V1 demande de saisir les réponses en texte : ce coût fait partie de la mesure, au même titre que le temps éventuellement gagné.",
  ],
  [
    "Sur quelles matières peut-on commencer ?",
    "Le parcours d’analyse actuel couvre les mathématiques. Un pilote peut commencer avec un professeur volontaire, une classe et une évaluation. L’accès se fait sur invitation ; les comptes et les affectations sont préparés avec l’équipe FOCUS.",
  ],
  [
    "Quelles données utiliser pour la démonstration ?",
    "La démonstration commence avec des copies fictives. Avant de traiter des données réelles d’élèves, l’établissement doit valider l’hébergement, les accès, la conservation, les conditions contractuelles et le cadre de protection des données. Une démonstration réussie ne prouve pas à elle seule que le service est prêt pour la production.",
  ],
];

export default function PresentationPage() {
  const requestUrl = demoRequestUrl();
  return (
    <>
      <section className={styles.hero}>
        <div className={`${styles.container} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>FOCUS TEACHER · SUIVI PÉDAGOGIQUE</p>
            <h1>
              Une note donne un résultat.
              <br />
              <em>La copie explique où l’élève bloque.</em>
            </h1>
            <p className={styles.heroText}>
              FOCUS relie les réponses des élèves aux notions travaillées et
              prépare des observations que le professeur vérifie. Les preuves
              restent visibles. La décision reste humaine.
            </p>
            <div className={styles.heroActions}>
              <a href={requestUrl} className={styles.primaryButton}>
                Demander une démonstration{" "}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a href="#fonctionnement" className={styles.secondaryButton}>
                Comprendre le parcours
              </a>
            </div>
            <p className={styles.heroTrust}>
              Pilote en mathématiques · Une classe pour commencer · Accès sur
              invitation
            </p>
          </div>
          <figure
            className={styles.proofPreview}
            aria-labelledby="preview-caption"
          >
            <figcaption id="preview-caption">
              Données fictives de démonstration · réponse et analyse
              illustratives
            </figcaption>
            <div className={styles.proofTop}>
              <FileText size={18} aria-hidden="true" />
              <span>Développement par distributivité</span>
              <span className={styles.pendingLabel}>Hypothèse à examiner</span>
            </div>
            <div className={styles.proofSection}>
              <span className={styles.cardLabel}>
                PREUVE · CE QUE L’ÉLÈVE A ÉCRIT
              </span>
              <blockquote>« 2(x + 3) = 2x + 3 »</blockquote>
            </div>
            <div className={styles.proofSection}>
              <span className={styles.cardLabel}>INTERPRÉTATION PROPOSÉE</span>
              <h3>Le facteur 2 n’est appliqué qu’au premier terme.</h3>
              <p>
                À vérifier à partir de la copie et du corrigé, puis d’une
                nouvelle question si nécessaire.
              </p>
            </div>
            <dl className={styles.proofMeta}>
              <div>
                <dt>Notion</dt>
                <dd>Distributivité</dd>
              </div>
              <div>
                <dt>Niveau de preuve</dt>
                <dd>Limité · une observation</dd>
              </div>
            </dl>
            <div className={styles.teacherDecision}>
              <UserCheck size={20} aria-hidden="true" />
              <p>
                <strong>Le professeur décide.</strong>
                <br />
                Confirmer enrichit le suivi. Écarter conserve la proposition
                dans l’historique.
              </p>
            </div>
          </figure>
        </div>
      </section>
      <section className={styles.section} id="difference">
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>LE PROBLÈME À RÉSOUDRE</p>
            <h2>Passer du résultat à la difficulté précise.</h2>
            <p>
              Une moyenne indique un niveau global. Pour choisir la suite, le
              professeur doit retrouver ce qui a posé problème, dans quelle
              question et à quel moment.
            </p>
          </div>
          <div className={styles.valueGrid}>
            <article>
              <ScanText aria-hidden="true" />
              <h3>Relire avec un point de départ</h3>
              <p>
                Les extraits et les notions sont rassemblés pour préparer la
                relecture des copies. Le temps gagné reste à mesurer.
              </p>
            </article>
            <article>
              <FileText aria-hidden="true" />
              <h3>Nommer la difficulté</h3>
              <p>
                Une proposition renvoie à une réponse précise. Sans preuves
                suffisantes, FOCUS indique ses limites.
              </p>
            </article>
            <article>
              <UserCheck aria-hidden="true" />
              <h3>Suivre les observations dans le temps</h3>
              <p>
                Les observations confirmées et les évaluations associées sont
                accessibles dans la fiche élève.
              </p>
            </article>
          </div>
          <p className={styles.integrationNote}>
            En complément des outils de vie scolaire. Les notes officielles et
            les décisions pédagogiques restent sous la responsabilité de
            l’établissement.
          </p>
        </div>
      </section>
      <section
        className={`${styles.section} ${styles.softSection}`}
        id="fonctionnement"
      >
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>L’USAGE AU QUOTIDIEN</p>
            <h2>De la copie à une observation contrôlée.</h2>
            <p>
              Un parcours professeur, sans conversation avec un chatbot et sans
              conclusions cachées derrière un graphique.
            </p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <h3>Préparer l’évaluation</h3>
              <p>
                Sujet, questions, corrigé et notions. Puis les réponses exactes
                des élèves, saisies en texte.
              </p>
            </li>
            <li>
              <span>02</span>
              <h3>Examiner les propositions</h3>
              <p>
                L’analyse affiche la preuve, l’interprétation, la notion et le
                niveau de preuve.
              </p>
            </li>
            <li>
              <span>03</span>
              <h3>Confirmer ou écarter</h3>
              <p>
                Le professeur contrôle chaque hypothèse. Les propositions non
                confirmées restent distinctes.
              </p>
            </li>
            <li>
              <span>04</span>
              <h3>Retrouver le suivi</h3>
              <p>
                La fiche élève relie les observations aux évaluations et montre
                leur évolution.
              </p>
            </li>
          </ol>
        </div>
      </section>
      <section className={styles.section} id="confiance">
        <div className={`${styles.container} ${styles.trustGrid}`}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>LA CONFIANCE SE VÉRIFIE</p>
            <h2>
              L’analyse propose.
              <br />
              Le professeur décide.
            </h2>
            <p>
              Une hypothèse ne devient une observation confirmée qu’après votre
              décision. Un manque de preuve reste visible.
            </p>
            <a className={styles.textLink} href="#faq">
              Voir les limites de la V1{" "}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
          <ul className={styles.trustList}>
            {[
              [
                "Preuves visibles",
                "L’extrait de la réponse et la notion sont affichés à côté de l’interprétation.",
              ],
              [
                "Décisions révisables",
                "Confirmer ou écarter reste un choix du professeur, tant que les preuves n’ont pas changé.",
              ],
              [
                "Incertitude explicite",
                "« Preuves insuffisantes » et « aucune erreur observée » ne sont pas présentés comme une maîtrise acquise.",
              ],
              [
                "Pilote encadré",
                "Les conditions d’accès et de traitement des données doivent être vérifiées avant tout usage réel.",
              ],
            ].map(([title, detail]) => (
              <li key={title}>
                <Check size={18} aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section
        className={`${styles.section} ${styles.softSection}`}
        id="pilote"
      >
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>COMMENCER PETIT</p>
            <h2>Un professeur. Une classe. Une évaluation.</h2>
            <p>
              Le pilote sert à vérifier une utilité concrète avant d’étendre
              l’usage. Il commence par une démonstration avec des données
              fictives.
            </p>
          </div>
          <div className={styles.pilotGrid}>
            <article>
              <h3>Ce que l’on met à l’épreuve</h3>
              <ul>
                <li>Temps total de saisie, d’analyse et de validation.</li>
                <li>Pertinence des difficultés proposées et taux de refus.</li>
                <li>Capacité à choisir une prochaine action pédagogique.</li>
              </ul>
            </article>
            <article>
              <h3>Ce qui doit être prêt</h3>
              <ul>
                <li>Un accès professeur et des affectations vérifiés.</li>
                <li>
                  Un sujet, son corrigé et quelques réponses exploitables.
                </li>
                <li>
                  Un cadre de données validé par l’établissement avant usage
                  réel.
                </li>
              </ul>
            </article>
          </div>
          <a href={requestUrl} className={styles.primaryButton}>
            Discuter d’un pilote <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </section>
      <section id="faq" className={styles.section}>
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>QUESTIONS D’ÉTABLISSEMENT</p>
          <h2>Ce qu’il faut savoir avant de commencer.</h2>
          <div className={styles.faq}>
            {questions.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <section className={styles.cta} id="contact">
        <div className={styles.narrow}>
          <p className={styles.sectionLabel}>VOIR LE PRODUIT EN SITUATION</p>
          <h2>Cinq minutes pour comprendre le parcours.</h2>
          <p>
            Une copie, une proposition expliquée et une décision professeur.
            Puis un échange sur ce qu’un pilote doit prouver dans votre
            établissement.
          </p>
          <a href={requestUrl} className={styles.lightButton}>
            Demander une démonstration{" "}
            <ArrowRight size={17} aria-hidden="true" />
          </a>
          {requestUrl.startsWith("mailto:") && (
            <small>
              Ouvre votre messagerie. La demande est envoyée lorsque vous
              validez votre e-mail.
            </small>
          )}
          <Link href="/connexion" className={styles.loginFooter}>
            Vous avez déjà un accès ? Se connecter à FOCUS Teacher
          </Link>
        </div>
      </section>
    </>
  );
}
