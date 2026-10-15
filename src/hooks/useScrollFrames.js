import { useState, useEffect, useRef, useCallback } from 'react'
import { usePreloadedImages } from '../context/PreloadContext'

// Scrubs a preloaded frame sequence on a canvas as the section scrolls past.
// Returns the scroll progress (0..1) so scenes can time their captions.
export function useScrollFrames(sectionRef, sceneKey) {
  const images = usePreloadedImages()
  const frames = images[sceneKey]
  const [progress, setProgress] = useState(0)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const rafRef = useRef(null)
  const currentFrameRef = useRef(-1)

  const drawFrame = useCallback((index) => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    const img = frames[index]
    if (!canvas || !ctx || !img || !img.complete || !img.naturalWidth) return

    const canvasRatio = canvas.width / canvas.height
    const imgRatio = img.naturalWidth / img.naturalHeight
    let drawWidth, drawHeight, drawX, drawY

    if (imgRatio > canvasRatio) {
      drawHeight = canvas.height
      drawWidth = img.naturalWidth * (canvas.height / img.naturalHeight)
      drawX = (canvas.width - drawWidth) / 2
      drawY = 0
    } else {
      drawWidth = canvas.width
      drawHeight = img.naturalHeight * (canvas.width / img.naturalWidth)
      drawX = 0
      drawY = (canvas.height - drawHeight) / 2
    }

    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)
  }, [frames])

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
  }, [])

  useEffect(() => {
    let ticking = false

    const update = () => {
      const section = sectionRef.current
      ticking = false
      if (!section) return

      const rect = section.getBoundingClientRect()
      const scrollHeight = section.offsetHeight - window.innerHeight
      const fraction = scrollHeight > 0 ? Math.max(0, Math.min(1, -rect.top / scrollHeight)) : 0
      const frameIndex = Math.min(frames.length - 1, Math.floor(fraction * frames.length))

      if (frameIndex !== currentFrameRef.current) {
        currentFrameRef.current = frameIndex
        drawFrame(frameIndex)
      }
      setProgress(fraction)
    }

    const handleScroll = () => {
      if (ticking) return
      ticking = true
      rafRef.current = requestAnimationFrame(update)
    }

    const handleResize = () => {
      sizeCanvas()
      drawFrame(Math.max(0, currentFrameRef.current))
      update()
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)
    update()

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [sectionRef, frames, drawFrame, sizeCanvas])

  const initCanvas = useCallback((canvas) => {
    if (!canvas || canvasRef.current === canvas) return
    canvasRef.current = canvas
    ctxRef.current = canvas.getContext('2d')
    sizeCanvas()
    drawFrame(Math.max(0, currentFrameRef.current))
  }, [sizeCanvas, drawFrame])

  return { progress, initCanvas }
}

// Opacity for a caption visible between `from` and `to` (scroll fractions), with soft edges.
export function captionOpacity(progress, from, to, fade = 0.06) {
  if (progress < from - fade || progress > to + fade) return 0
  if (progress < from) return (progress - (from - fade)) / fade
  if (progress > to) return 1 - (progress - to) / fade
  return 1
}
