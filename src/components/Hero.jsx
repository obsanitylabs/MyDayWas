import { ScrollScene } from './ScrollScene'
import { APP_URL } from '../config'
import styles from './Hero.module.css'

const captions = [
  { from: 0.42, to: 0.66, eyebrow: 'Tonight', text: 'One sentence is enough.', sub: 'Tired. Happy. Lonely. Proud. Just write how it really was.' },
  { from: 0.76, to: 1.02, eyebrow: 'Sealed', text: 'Your words stay yours.', sub: 'No one reads your diary. Not your friends, not advertisers, not us.' },
]

export function Hero() {
  return (
    <ScrollScene id="hero" scene="day" height="350vh" captions={captions}>
      {(progress) => {
        const opacity = Math.max(0, Math.min(1, 1 - (progress - 0.06) / 0.18))
        return (
          <div
            className={styles.content}
            style={{
              opacity,
              visibility: opacity > 0 ? 'visible' : 'hidden',
              transform: `translateY(${(1 - opacity) * -30}px)`,
            }}
          >
            <span className={styles.badge}>
              <span className={styles.dot}></span>
              A private diary for the whole planet
            </span>
            <h1 className={styles.title}>
              How was your <em className="serif">day?</em>
            </h1>
            <p className={styles.subtitle}>
              Write it down. Only you will ever read it. But together, our days draw the first
              real map of how humanity is doing.
            </p>
            <div className={styles.buttons}>
              <a href={APP_URL} className={styles.btnPrimary}>Start writing</a>
              <a href="#mission" className={styles.btnSecondary}>Our mission</a>
            </div>
            <div className={styles.scrollHint}>
              <span></span>
              Scroll
            </div>
          </div>
        )
      }}
    </ScrollScene>
  )
}
