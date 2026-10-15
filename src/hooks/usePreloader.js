import { useState, useEffect, useRef } from 'react'

const BASE_URL = import.meta.env.BASE_URL || '/'
const FRAMES_PER_VIDEO = 51

// Each scroll scene plays two chained videos
export const SCENES = {
  day: ['video1', 'video2'],
  map: ['video3', 'video4'],
  tomorrow: ['video5', 'video6'],
}

export function usePreloader() {
  const [progress, setProgress] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const imagesRef = useRef({ day: [], map: [], tomorrow: [] })

  useEffect(() => {
    // Effects can run twice in dev (StrictMode), so always start from empty lists
    imagesRef.current = { day: [], map: [], tomorrow: [] }
    const totalImages = Object.values(SCENES).flat().length * FRAMES_PER_VIDEO
    let loadedCount = 0
    let cancelled = false

    const handleLoad = () => {
      if (cancelled) return
      loadedCount++
      setProgress(Math.round((loadedCount / totalImages) * 100))
      if (loadedCount === totalImages) setIsLoaded(true)
    }

    Object.entries(SCENES).forEach(([scene, folders]) => {
      folders.forEach((folder) => {
        for (let i = 1; i <= FRAMES_PER_VIDEO; i++) {
          const img = new Image()
          img.src = `${BASE_URL}${folder}/frame-${String(i).padStart(3, '0')}.jpg`
          img.onload = handleLoad
          img.onerror = handleLoad
          imagesRef.current[scene].push(img)
        }
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  return { progress, isLoaded, images: imagesRef.current }
}
