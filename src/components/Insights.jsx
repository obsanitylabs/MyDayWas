import { useInView } from '../hooks/useInView'
import styles from './Insights.module.css'

// Illustrative only: the kind of ranking the map is built to produce
const signals = [
  { label: 'Loneliness', value: 0.86, tone: 'night' },
  { label: 'Poor sleep', value: 0.78, tone: 'night' },
  { label: 'Money stress', value: 0.71, tone: 'warm' },
  { label: 'Skipped meals', value: 0.58, tone: 'warm' },
  { label: 'Long commutes', value: 0.47, tone: 'warm' },
  { label: 'Unsafe housing', value: 0.36, tone: 'warm' },
]

const uses = [
  { title: 'For cities', text: 'See which neighborhoods are lonely, hungry or exhausted before it becomes a crisis.' },
  { title: 'For researchers', text: 'Daily, ground-level wellbeing data that surveys once a year could never capture.' },
  { title: 'For builders', text: 'Know which real problems are worth solving, ranked by the people who live them.' },
]

export function Insights() {
  const [ref, isInView] = useInView({ once: true, threshold: 0.3 })

  return (
    <section className={styles.section} id="insights">
      <div className={styles.glow}></div>
      <div className={styles.container}>
        <div className={styles.header}>
          <span className="eyebrow">What the map reveals</span>
          <h2 className={styles.title}>
            The biggest problems people face, <em className="serif">ranked by the people facing them.</em>
          </h2>
          <p className={styles.subtitle}>
            Every sealed entry adds a few anonymous signals. Combined across cities and countries,
            they show where life is getting harder, and where help would matter most.
          </p>
        </div>

        <div className={styles.grid}>
          <div className={`${styles.chart} ${isInView ? styles.visible : ''}`} ref={ref}>
            <div className={styles.chartHeader}>
              <span>Most mentioned this week</span>
              <span className={styles.tag}>Illustrative preview</span>
            </div>
            {signals.map((s, i) => (
              <div key={s.label} className={styles.row}>
                <span className={styles.rowLabel}>{s.label}</span>
                <div className={styles.track}>
                  <div
                    className={`${styles.bar} ${styles[s.tone]}`}
                    style={{ '--w': s.value, transitionDelay: `${i * 120}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className={styles.uses}>
            {uses.map((u) => (
              <div key={u.title} className={styles.use}>
                <h3 className={styles.useTitle}>{u.title}</h3>
                <p className={styles.useText}>{u.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
