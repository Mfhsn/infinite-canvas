# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-14
- Primary product surfaces: homepage, canvas library, infinite canvas, image studio, video studio, prompt library, asset library
- Evidence reviewed: `README.md`, `AGENTS.md`, `web/src/pages/home/index.tsx`, `web/src/pages/canvas/index.tsx`, `web/src/constant/navigation-tools.ts`, `web/src/lib/app-theme.ts`, `web/src/stores/canvas/use-canvas-store.ts`, `web/src/stores/use-asset-store.ts`
- External references: Adobe Firefly app, Runway app, FLORA, Krea, Ant Design design values, WCAG 2.2 contrast and target-size guidance

## Brand

- Personality: calm, capable, experimental, creator-first
- Trust signals: show real product entry points, local project state, and clear outcomes instead of decorative AI claims
- Avoid: generic AI gradients, neon overload, glassmorphism stacks, stock-image galleries, empty oversized hero sections, and imitation of FLORA's dotted-canvas homepage

## Product goals

- Goals: help users start or resume visual creation immediately; make the full image/video/canvas workflow legible; keep the homepage useful offline
- Non-goals: redesign global navigation, change generation flows, introduce cloud project state, or become a public marketing website
- Success signals: every core tool is one click away; new and returning users both see a useful first screen; the homepage makes no showcase-only network request

## Personas and jobs

- Primary personas: individual AI visual creators, local/self-hosted users, and technically confident creative experimenters
- User jobs: start a canvas, continue a project, generate an image or video, find a prompt, and reuse a saved asset
- Key contexts of use: desktop-first creative sessions with responsive support for quick mobile navigation

## Information architecture

- Primary navigation: retain the existing global top navigation
- Core routes/screens: `/`, `/canvas`, `/image`, `/video`, `/prompts`, `/assets`
- Content hierarchy: creation CTA -> workflow preview -> quick-start tools -> recent canvases -> recent assets when available

## Design principles

- Action before explanation: the homepage is a launchpad, not a second marketing layer
- Product over decoration: visuals should explain the connected workflow or reflect local user content
- Graceful emptiness: zero local data and offline use still produce a complete, intentional page
- Quiet confidence: one accent color, strong typography, thin borders, and restrained motion
- Tradeoffs: favor clarity and local reliability over a large remote inspiration gallery

## Visual language

- Color: existing neutral theme tokens with a homepage-scoped warm-orange signal accent; warm paper in light mode and graphite in dark mode
- Typography: existing sans stack, compact display headline with explicit semantic line breaks, short readable lines, and task-oriented microcopy; headline color changes only at the idea/outcome boundary
- Spacing/layout rhythm: asymmetric 12-column desktop composition, 24-32px section rhythm, single-column mobile flow
- Shape/radius/elevation: 16-24px cards, 1px borders, low or no shadows, no stacked translucent glass layers
- Motion: 160-220ms hover/focus feedback only; no continuous hero animation; honor `prefers-reduced-motion`
- Imagery/iconography: Lucide icons, CSS/inline-SVG workflow lines, optional local user thumbnails; no remote homepage artwork

## Components

- Existing components to reuse: Ant Design `Button`, Lucide icons, global top navigation, theme and i18n providers
- New/changed components: homepage-private workflow preview, quick-start cards, recent-project links, conditional recent-asset tiles
- Variants and states: hydrated/unhydrated, empty/populated, light/dark, Chinese/English, desktop/mobile
- Token/component ownership: global theme remains in `web/src/lib/app-theme.ts`; homepage styling stays in `web/src/pages/home/index.tsx`

## Accessibility

- Target standard: WCAG 2.2 AA for the redesigned homepage
- Keyboard/focus behavior: all route cards and CTAs are semantic links/buttons with visible focus treatment
- Contrast/readability: at least 4.5:1 for normal text and 3:1 for large text
- Screen-reader semantics: one page heading, ordered section headings, meaningful labels, decorative preview elements hidden when appropriate
- Reduced motion and sensory considerations: remove looping title animation and disable non-essential transforms when reduced motion is requested

## Responsive behavior

- Supported breakpoints/devices: 390px mobile, 768-1024px tablet, and 1280px+ desktop
- Layout adaptations: hero changes from asymmetric two-column to a linear flow; tool cards and recent content reflow without horizontal scrolling
- Touch/hover differences: cards remain understandable without hover; primary touch targets are at least 40px where practical and never below 24px

## Interaction states

- Loading: core launch actions render immediately; local recent sections appear only after store hydration
- Empty: show an intentional starter path rather than empty galleries or large skeletons
- Error: homepage has no showcase-only remote request; broken local thumbnails fall back to a neutral visual tile
- Success: navigation is immediate and uses existing routes
- Disabled: continue action falls back to new-canvas behavior when no project exists
- Offline/slow network: all homepage structure and navigation remain available

## Content voice

- Tone: concise, encouraging, concrete
- Terminology: use existing product names such as 画布、生图工作台、视频创作台、提示词库、我的素材
- Microcopy rules: describe the user outcome first; avoid hype, superlatives, and vague AI promises

## Implementation constraints

- Framework/styling system: Vite, React, TypeScript, React Router, Tailwind CSS, Ant Design, Zustand
- Design-token constraints: reuse `bg-background`, `text-foreground`, border and muted tokens; keep accent scoped to the homepage
- Performance constraints: no new dependency, no homepage-only remote image fetch, no looping animation, and bounded recent-data rendering
- Compatibility constraints: preserve existing route and local-store contracts
- Test/screenshot expectations: format check, TypeScript/Vite build, light/dark desktop and mobile screenshots, keyboard and route checks

## Open questions

- [ ] Revisit the homepage accent only if broader brand work later introduces a repository-wide brand palette.
- [ ] Consider richer project thumbnails only after the canvas store has a stable thumbnail-generation contract.
