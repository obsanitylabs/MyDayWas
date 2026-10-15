import { APP_URL } from '../config'
import styles from './CTA.module.css'

export function CTA() {
  return (
    <section className={styles.section} id="cta">
      <div className={styles.glow}></div>
      <div className={styles.orbs} aria-hidden="true">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} style={{ '--i': i }}></span>
        ))}
      </div>
      <div className={styles.container}>
        <h2 className={styles.title}>
          Start writing. <em className="serif">Tonight.</em>
        </h2>
        <p className={styles.subtitle}>
          Tell your diary how your day was. Keep it private. Help the world finally see what people
          really live through. And get a hand when you need one.
        </p>
        <a href={APP_URL} className={styles.btn}>Write your first day</a>
        <p className={styles.note}>Free · Private by default · Early demo</p>
      </div>
    </section>
  )
}
