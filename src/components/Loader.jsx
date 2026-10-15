import { Logo } from './Logo'
import styles from './Loader.module.css'

export function Loader({ progress }) {
  return (
    <div className={styles.loader}>
      <div className={styles.content}>
        <div className={styles.logo}>
          <Logo size="lg" />
        </div>
        <p className={styles.line}>Collecting today&rsquo;s light…</p>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.progressText}>{progress}%</div>
      </div>
    </div>
  )
}
