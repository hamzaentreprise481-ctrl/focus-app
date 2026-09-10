import Link from "next/link";
import styles from "./page.module.css";
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.marketing}>
      <a href="#main-content" className="skip-link">
        Aller au contenu
      </a>
      <header className={styles.header}>
        <div className={styles.container}>
          <Link href="/" className={styles.brand} aria-label="FOCUS, accueil">
            <span className={styles.mark}>F</span>FOCUS
          </Link>
          <nav aria-label="Navigation du site">
            <Link href="/#fonctionnement">Fonctionnement</Link>
            <Link href="/#confiance">Notre approche</Link>
            <Link href="/#faq">Questions fréquentes</Link>
          </nav>
          <Link href="/connexion" className={styles.smallButton}>
            Espace professeur
          </Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          <Link href="/" className={styles.brand}>
            FOCUS
          </Link>
          <p>Le suivi pédagogique, à votre rythme.</p>
          <span>© 2026 FOCUS</span>
        </div>
      </footer>
    </div>
  );
}
