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
            <Link href="/decouvrir">Découvrir</Link>
            <Link href="/fonctionnement">Fonctionnement</Link>
            <Link href="/confiance">Confiance</Link>
            <Link href="/abonnements">Abonnements</Link>
            <Link href="/questions">Questions</Link>
          </nav>
          <Link href="/#espaces" className={styles.smallButton}>
            Accéder à FOCUS
          </Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          <Link href="/" className={styles.brand}>
            FOCUS
          </Link>
          <p>Teacher · Student · Director</p>
          <span>© 2026 FOCUS</span>
        </div>
      </footer>
    </div>
  );
}
