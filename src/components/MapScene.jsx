import { ScrollScene } from './ScrollScene'

const captions = [
  { from: 0.04, to: 0.26, eyebrow: 'Every night', text: 'Millions of people write how their day was.', position: 'top' },
  { from: 0.34, to: 0.56, eyebrow: 'Anonymous by design', text: 'Each entry stays sealed.', sub: 'AI reads the patterns, never the person. No names, no profiles, no ads.' },
  { from: 0.66, to: 1.02, eyebrow: 'The map', text: 'Together, they draw the first real map of how humanity is doing.', sub: 'Loneliness. Hunger. Exhaustion. Hope. Measured for the first time, by the people living it.' },
]

export function MapScene() {
  return <ScrollScene id="map" scene="map" height="420vh" captions={captions} />
}
