import { createContext, useContext } from 'react'

export const PreloadContext = createContext(null)

export function usePreloadedImages() {
  const context = useContext(PreloadContext)
  if (!context) {
    throw new Error('usePreloadedImages must be used within PreloadProvider')
  }
  return context
}
