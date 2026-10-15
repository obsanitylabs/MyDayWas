import { useInView } from '../hooks/useInView'
import styles from './Mission.module.css'

const blindSpots = [
  { icon: '🫥', title: 'Loneliness', desc: 'Millions go days without a real conversation. It never shows up in a spreadsheet.' },
  { icon: '🍽️', title: 'Skipped meals', desc: 'Not famine headlines. The quiet "I forgot to eat again" of an ordinary Tuesday.' },
  { icon: '🌙', title: 'Exhaustion', desc: 'Bad sleep, long commutes, double shifts. Felt by everyone, measured by no one.' },
  { icon: '💸', title: 'Money stress', desc: 'The rent math people do in their heads every night before falling asleep.' },
  { icon: '🏠', title: 'Living conditions', desc: 'Noise, mold, heat, unsafe streets. The daily friction that wears people down.' },
  { icon: '🤝', title: 'No one to ask', desc: 'Needing a ride, a hand at home, or just a friend, and not knowing who to call.' },
]

function BlindSpotCard({ icon, title, desc, delay }) {
  const [ref, isInView] = useInView({ once: true, threshold: 0.2 })

  return (
    <div
      ref={ref}
      className={`${styles.card} ${isInView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay * 90}ms` }}
    >
      <div className={styles.cardIcon}>{icon}</div>
      <h3 className={styles.cardTitle}>{title}</h3>
      <p className={styles.cardDesc}>{desc}</p>
    </div>
  )
}

export function Mission() {
  return (
    <section className={styles.section} id="mission">
      <div className={styles.container}>
        <div className={styles.grid}>
          <div className={styles.content}>
            <span className="eyebrow">The mission</span>
            <h2 className={styles.title}>
              We measure everything, except <em className="serif">how people actually live.</em>
            </h2>
            <p className={styles.subtitle}>
              Markets are tracked to the millisecond. Clicks, steps, GDP, weather. But how people
              really feel at the end of an ordinary day (lonely, hungry, exhausted, hopeful) has
              never been collected at scale.
            </p>
            <p className={styles.subtitle}>
              MyDayWas turns private diaries into the first honest, anonymous picture of daily human
              life. So we can finally see the biggest problems people face, and plan real solutions.
            </p>
          </div>
          <div className={styles.cards}>
            {blindSpots.map((item, index) => (
              <BlindSpotCard key={item.title} {...item} delay={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
