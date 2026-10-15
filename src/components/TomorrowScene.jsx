import { ScrollScene } from './ScrollScene'

const captions = [
  { from: 0.04, to: 0.22, eyebrow: 'The next morning', text: 'Your diary remembers. And it asks.', position: 'top' },
  { from: 0.3, to: 0.46, quote: 'Did you eat today?' },
  { from: 0.52, to: 0.68, quote: 'Do you still feel lonely, like you mentioned last week?' },
  { from: 0.78, to: 1.02, eyebrow: 'Real help', text: 'And when you need a hand, it’s one message away.', sub: 'A ride. A clean home. A friend for coffee. Through our curated partner network.' },
]

export function TomorrowScene() {
  return <ScrollScene id="tomorrow" scene="tomorrow" height="420vh" captions={captions} />
}
