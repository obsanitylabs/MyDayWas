# MyDayWas

Landing page for **MyDayWas**: a private diary where you simply write how your day was. Entries stay private, while anonymous signals help map how people across the planet are really doing. The diary can ask follow-up questions, and users can request help through a curated partner network.

## Stack

- React 18 + Vite 5
- CSS Modules, no UI framework
- Scroll-driven "video" scenes: each scene scrubs through pre-extracted JPG frames on a `<canvas>`

## Run locally

```bash
npm install
npm run dev
```

Production build (output in `dist/`):

```bash
npm run build
```

The site is built for the domain root. To serve it from a subfolder, set `BASE_PATH`, e.g. `BASE_PATH=landing npm run build`.

## Deploy

`netlify.toml` is included: build command `npm run build`, publish directory `dist`.

## Where things live

| What | Where |
| --- | --- |
| Link used by every "Start writing" button | `src/config.js` (`APP_URL`) |
| Page sections, in order | `src/App.jsx` |
| Copy for each section | `src/components/*.jsx` |
| Scroll scene captions and timing | `Hero.jsx`, `MapScene.jsx`, `TomorrowScene.jsx` (`from`/`to` are scroll fractions, 0 to 1) |
| Colors and fonts | `src/index.css` (`:root` variables) |
| Video frames | `public/video1` … `public/video6`, 51 frames each |

### Scenes

| Scene | Frames | Story |
| --- | --- | --- |
| `day` (hero) | video1 + video2 | Mia writes how her day was; it becomes a sealed light that leaves through the window |
| `map` | video3 + video4 | Lights rise from every window and form a living map of humanity |
| `tomorrow` | video5 + video6 | Back down at sunrise: the diary checks in, and help arrives |

### Replacing a video

Export 51 frames at 1280px wide into the matching folder, named `frame-001.jpg` … `frame-051.jpg`:

```bash
ffmpeg -i "video 1.mp4" -vf "fps=51/5.0417,scale=1280:-2" -frames:v 51 -q:v 6 public/video1/frame-%03d.jpg
```

(`5.0417` is the clip length in seconds; adjust for other clips.)
