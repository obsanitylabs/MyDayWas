import { useInView } from '../hooks/useInView'
import styles from './Promises.module.css'

const promises = [
  { big: '0', label: 'People who can read your diary' },
  { big: '1', label: 'Sentence a day is enough' },
  { big: '100%', label: 'Anonymous in the global map' },
  { big: '8B', label: 'Lives worth understanding' },
]

function PromiseItem({ big, label, delay }) {
  const [ref, isInView] = useInView({ once: true, threshold: 0.5 })

  return (
    <div
      ref={ref}
      className={`${styles.item} ${isInView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay * 100}ms` }}
    >
      <div className={styles.number}>{big}</div>
      <div className={styles.label}>{label}</div>
    </div>
  )
}

export function Promises() {
  return (
    <section className={styles.section} id="privacy">
      <div className={styles.container}>
        <div className={styles.grid}>
          {promises.map((p, index) => (
            <PromiseItem key={p.label} {...p} delay={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
