import { useRef, useCallback } from 'react'
import { useScrollFrames, captionOpacity } from '../hooks/useScrollFrames'
import styles from './ScrollScene.module.css'

// A pinned, rounded "screen" whose frames scrub with scroll.
// `captions` fade in and out at given scroll fractions; `children(progress)` renders custom overlay content.
export function ScrollScene({ id, scene, height = '400vh', captions = [], children }) {
  const sectionRef = useRef(null)
  const { progress, initCanvas } = useScrollFrames(sectionRef, scene)

  const canvasRef = useCallback((node) => {
    if (node) initCanvas(node)
  }, [initCanvas])

  return (
    <section className={styles.section} id={id} ref={sectionRef} style={{ height }}>
      <div className={styles.sticky}>
        <div className={styles.canvasWrapper}>
          <canvas ref={canvasRef} className={styles.canvas}></canvas>
        </div>
        <div className={styles.overlay}></div>

        {captions.map((caption, i) => {
          const opacity = captionOpacity(progress, caption.from, caption.to)
          return (
            <div
              key={i}
              className={`${styles.caption} ${caption.position === 'top' ? styles.captionTop : ''}`}
              style={{
                opacity,
                transform: `translate(-50%, ${(1 - opacity) * 24}px)`,
                visibility: opacity > 0 ? 'visible' : 'hidden',
              }}
            >
              {caption.eyebrow && <span className="eyebrow">{caption.eyebrow}</span>}
              {caption.quote ? (
                <p className={styles.quote}>&ldquo;{caption.quote}&rdquo;</p>
              ) : (
                <p className={styles.captionText}>{caption.text}</p>
              )}
              {caption.sub && <p className={styles.captionSub}>{caption.sub}</p>}
            </div>
          )
        })}

        {children && children(progress)}

        <div className={styles.progressRail}>
          <div className={styles.progressFill} style={{ transform: `scaleY(${progress})` }} />
        </div>
      </div>
    </section>
  )
}
