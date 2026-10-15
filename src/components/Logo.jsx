import styles from './Logo.module.css'

export function Logo({ size = 'md' }) {
  return (
    <span className={`${styles.logo} ${styles[size]}`}>
      <span className={styles.orb}></span>
      my<span className={styles.day}>day</span>was
    </span>
  )
}
