import { useInView } from '../hooks/useInView'
import styles from './Partners.module.css'

const partners = [
  { icon: '🧹', title: 'Home help', tag: 'House cleaning', desc: 'Overwhelmed week? Book trusted cleaners straight from your diary.' },
  { icon: '🚗', title: 'Rides', tag: 'Ride sharing', desc: 'Late shift, no bus, long walk home. Get a ride when you need one.' },
  { icon: '☕', title: 'Friend-dates', tag: 'Real company', desc: 'Lonely lately? Meet someone nearby for a coffee, a walk or a game night.' },
  { icon: '✨', title: 'And growing', tag: 'More every month', desc: 'Meals, errands, support groups. The network grows with what the map shows people need.' },
]

function PartnerCard({ icon, title, tag, desc, delay }) {
  const [ref, isInView] = useInView({ once: true, threshold: 0.2 })

  return (
    <div
      ref={ref}
      className={`${styles.card} ${isInView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay * 100}ms` }}
    >
      <div className={styles.cardIcon}>{icon}</div>
      <h3 className={styles.cardTitle}>{title}</h3>
      <div className={styles.cardTag}>{tag}</div>
      <p className={styles.cardDesc}>{desc}</p>
    </div>
  )
}

export function Partners() {
  return (
    <section className={styles.section} id="partners">
      <div className={styles.container}>
        <span className="eyebrow">The partner network</span>
        <h2 className={styles.title}>
          From <em className="serif">“I’m not okay”</em> to someone at the door.
        </h2>
        <p className={styles.subtitle}>
          When your diary notices you could use a hand, it can connect you (only if you ask) with
          our curated partners.
        </p>
        <div className={styles.grid}>
          {partners.map((p, index) => (
            <PartnerCard key={p.title} {...p} delay={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
