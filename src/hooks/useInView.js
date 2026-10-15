import { useState, useEffect, useRef } from 'react'

export function useInView(options = {}) {
  const [isInView, setIsInView] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          if (options.once) {
            observer.unobserve(element)
          }
        } else if (!options.once) {
          setIsInView(false)
        }
      },
      {
        threshold: options.threshold || 0.1,
        rootMargin: options.rootMargin || '0px 0px -50px 0px',
      }
    )

    observer.observe(element)

    return () => observer.unobserve(element)
  }, [options.threshold, options.rootMargin, options.once])

  return [ref, isInView]
}

export function useCounter(target, isActive, duration = 2000, isDecimal = false) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!isActive) return

    const steps = 60
    const stepDuration = duration / steps
    const increment = parseFloat(target) / steps
    let current = 0

    const counter = setInterval(() => {
      current += increment
      if (current >= parseFloat(target)) {
        current = parseFloat(target)
        clearInterval(counter)
      }
      setCount(current)
    }, stepDuration)

    return () => clearInterval(counter)
  }, [target, isActive, duration])

  if (isDecimal) {
    return count.toFixed(2)
  }
  return Math.floor(count).toLocaleString()
}
