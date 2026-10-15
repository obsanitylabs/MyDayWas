import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { Mission } from './components/Mission'
import { MapScene } from './components/MapScene'
import { HowItWorks } from './components/HowItWorks'
import { Insights } from './components/Insights'
import { TomorrowScene } from './components/TomorrowScene'
import { Partners } from './components/Partners'
import { Promises } from './components/Promises'
import { CTA } from './components/CTA'
import { Footer } from './components/Footer'
import { Loader } from './components/Loader'
import { usePreloader } from './hooks/usePreloader'
import { PreloadContext } from './context/PreloadContext'

function App() {
  const { progress, isLoaded, images } = usePreloader()

  if (!isLoaded) {
    return <Loader progress={progress} />
  }

  return (
    <PreloadContext.Provider value={images}>
      <Navbar />
      <Hero />
      <Mission />
      <MapScene />
      <Insights />
      <HowItWorks />
      <TomorrowScene />
      <Partners />
      <Promises />
      <CTA />
      <Footer />
    </PreloadContext.Provider>
  )
}

export default App
