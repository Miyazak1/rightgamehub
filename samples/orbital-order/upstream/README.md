# ⚛️ Orbital Order (Aufbau)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![js13k](https://img.shields.io/badge/js13k-practice-orange.svg)](https://js13kgames.com/)
[![Size](https://img.shields.io/badge/size-8.2KB-brightgreen.svg)](#)
![GitHub commit activity](https://img.shields.io/github/commit-activity/t/aftongauntlett/js13k-demo)

A physics puzzle game where you guide electrons into atomic orbitals using electromagnetic attraction and repulsion. Built for JS13K competition practice with vanilla JavaScript and Canvas 2D.

**[Play the game →](https://orbital-order.aftongauntlett.com/)**

**Stack:** Vanilla JS • Canvas 2D • Web Audio API • Terser

## What This Is

This started as warm-up for JS13K 2025. I wanted to practice building under extreme size constraints while finishing something polished.

The concept came from experiments with attraction/repulsion physics. Blue s-electrons follow your cursor, orange p-electrons run from it. Fill orbitals following real atomic structure rules. Hit an occupied orbital twice and the electron gets ejected. Six elements, from hydrogen to oxygen.

The visuals reminded me of electron shells, so I leaned into the atomic theme. Final size is 8.2KB zipped.

## Technical Overview

Single-file architecture with five classes (G, E, O, A, T). Custom build script concatenates source, minifies with Terser, and inlines everything into one HTML file. 47% compression from 47KB source to 25KB minified.

**Core systems:**

- **Game (G):** Canvas setup, input handling, game loop
- **Electron (E):** Physics simulation for attraction/repulsion
- **Orbital (O):** Level data, Aufbau validation, collision detection
- **Audio (A):** Procedural sound from Web Audio API
- **Tutorial (T):** Event-driven hints that appear during play

All sound generated from code. No assets, no libraries. Canvas 2D for rendering, Web Audio for effects.

**Build pipeline:** Node script reads source files, Terser minifies with property mangling and 3-pass compression. Unsafe optimizations enabled (arrows, math, prototypes). Output is single HTML file under 13KB zipped.

## Development

```bash
# Clone and install
git clone https://github.com/aftongauntlett/js13k-demo.git
cd js13k-demo
npm install

# Run dev server
npm run dev
# Opens at localhost:8080

# Build production
npm run build
# Output: dist/index.html
```

Requirements: Node.js, Python 3 (for dev server).

## Project Structure

```
src/
├── index.html              # HTML template with inline CSS
├── GameGolfed.js           # Main game loop (class G)
├── components/
│   ├── ElectronGolfed.js   # Particle physics (class E)
│   └── TutorialGolfed.js   # Interactive hints (class T)
└── systems/
    ├── OrbitalSystemGolfed.js   # Level data and validation (class O)
    └── AudioSystemGolfed.js     # Procedural sound (class A)
```

## Challenges and Lessons

- **Size constraints are clarifying.** No room for waste. Every feature justified its byte cost. Led to procedural audio and single-file architecture.

- **Terser property mangling broke things.** Took trial and error to learn which patterns are safe. 3-pass compression gave diminishing returns but saved a few hundred bytes.

- **Canvas state management needs discipline.** Early bugs from improperly nested save/restore calls. Treating transforms as a stack fixed rendering issues.

- **Procedural audio takes iteration.** Raw waveforms sound harsh. Envelope shaping (attack/release) made tones smooth. Delay nodes added ambient texture.

- **Scope control matters.** I cut an infinite mode that caused state bugs. Better to ship six polished levels than six levels plus broken extras.

- **Playtesting changed the UX.** Early version had modal cards between levels. Testers found them jarring, so I made transitions seamless. Interactive tutorial replaced static intro after people skipped it.

## Accessibility

Interactive tutorial appears during play. Visual feedback shows valid/invalid moves (red glow, shaking). Audio is optional (M key to mute).

Limitations: Custom cursor may be hard for some users. Blue/orange distinction is not colorblind-friendly. No alternative input methods yet.

## What's Next

- More elements (up to Neon or beyond)
- Leaderboard with completion times
- Colorblind mode (patterns/textures)
- Mobile touch controls

---

MIT License. Built by [Afton Gauntlett](https://www.aftongauntlett.com/).
