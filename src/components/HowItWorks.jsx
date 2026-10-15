import { useEffect, useState, useRef } from 'react'
import styles from './HowItWorks.module.css'

const steps = [
  {
    icon: '✍️',
    title: 'Write how your day was',
    text: 'A sentence or a page. Typed at night, in bed, on the bus. No prompts, no streaks, no audience.',
  },
  {
    icon: '💬',
    title: 'Your diary asks back',
    text: 'It remembers what you shared and follows up gently, like a friend who actually pays attention.',
  },
  {
    icon: '🔒',
    title: 'Sealed, then mapped',
    text: 'Your words stay private. Only anonymous signals like sleep, meals, loneliness and stress join the global map.',
  },
  {
    icon: '🤝',
    title: 'Help, when you want it',
    text: 'Ask for a hand and our curated partner network shows up: rides, home help, friend-dates and more.',
  },
]

// Chat messages, each revealed when the scroll reaches its step
const messages = [
  { step: 0, from: 'me', text: 'Long day. Skipped lunch again, the bus was 40 min late and I didn’t talk to anyone after work.' },
  { step: 1, from: 'diary', text: 'That sounds draining. Did you get to eat something tonight?' },
  { step: 1, from: 'me', text: 'Just instant noodles 😅' },
  { step: 1, from: 'diary', text: 'Last Tuesday you said you felt lonely too. Is it still like that?' },
  { step: 2, from: 'system', text: 'Entry sealed · anonymous signals added: meals · commute · loneliness' },
  { step: 3, from: 'diary', text: 'Want me to find someone for a coffee walk this weekend? Our partners can set up a friend-date.', actions: ['Yes, please', 'Maybe later'] },
]

export function HowItWorks() {
  const sectionRef = useRef(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let ticking = false

    const update = () => {
      ticking = false
      const section = sectionRef.current
      if (!section) return
      const rect = section.getBoundingClientRect()
      const scrollHeight = section.offsetHeight - window.innerHeight
      setProgress(scrollHeight > 0 ? Math.max(0, Math.min(1, -rect.top / scrollHeight)) : 0)
    }

    const handleScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    update()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const activeStep = Math.min(steps.length - 1, Math.floor(progress * steps.length))

  return (
    <section className={styles.section} id="how" ref={sectionRef}>
      <div className={styles.sticky}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <span className="eyebrow">How it works</span>
            <h2 className={styles.title}>
              A diary that <em className="serif">listens back.</em>
            </h2>

            <ol className={styles.steps}>
              {steps.map((step, i) => (
                <li
                  key={step.title}
                  className={`${styles.step} ${i === activeStep ? styles.stepActive : ''} ${i < activeStep ? styles.stepDone : ''}`}
                >
                  <span className={styles.stepIcon}>{step.icon}</span>
                  <div>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepText}>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
            </div>
          </div>

          <div className={styles.right}>
            <div className={styles.phone}>
              <div className={styles.phoneHeader}>
                <span className={styles.phoneOrb}></span>
                <div>
                  <div className={styles.phoneTitle}>My diary</div>
                  <div className={styles.phoneMeta}>Only you can read this</div>
                </div>
              </div>

              <div className={styles.chat}>
                <div className={styles.date}>Tuesday, 11:42 PM</div>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`${styles.msg} ${styles[msg.from]} ${msg.step <= activeStep ? styles.msgVisible : ''}`}
                  >
                    {msg.from === 'system' && <span className={styles.lock}>🔒</span>}
                    {msg.text}
                    {msg.actions && (
                      <div className={styles.actions}>
                        {msg.actions.map((a) => <span key={a} className={styles.action}>{a}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className={styles.composer}>
                <span>My day was…</span>
                <span className={styles.send}>↑</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
