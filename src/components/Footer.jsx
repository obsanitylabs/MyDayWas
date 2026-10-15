import { Logo } from './Logo'
import { APP_URL } from '../config'
import styles from './Footer.module.css'

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.content}>
        <div className={styles.brand}>
          <Logo size="sm" />
          <span className={styles.tagline}>How was your day?</span>
        </div>
        <div className={styles.links}>
          <a href="#mission">Mission</a>
          <a href="#how">How it Works</a>
          <a href="#map">The Map</a>
          <a href="#partners">Partners</a>
          <a href={APP_URL}>Open the diary</a>
        </div>
        <div className={styles.copyright}>© 2026 MyDayWas</div>
      </div>
    </footer>
  )
}
