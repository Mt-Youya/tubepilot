<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

---
name: TubePilot
description: Automated pipeline from YouTube acquisition to multilingual publishing.
---

# Design System: TubePilot

## 1. Overview

**Creative North Star: "The Control Room"**

TubePilot is a dispatch console, not a consumer app. The visual language draws from flight-deck instruments and broadcast edit suites: deep, near-black surfaces that eliminate ambient glare; a single electric-blue accent that functions as an active-state signal, not a brand color; monospace type for every technical value that earns precision; and zero decoration that doesn't carry information. The "✈️" in the name is not ironic. This interface should feel like something a pilot trusts.

Information density is a design value, not a constraint to design around. The goal is never whitespace for its own sake. Every screen earns its breathing room by showing the user something real: a job in progress, a waveform, a timecode. Empty surfaces are a failure state, not a layout choice. Restrained color strategy means the accent appears only where it earns its place: active selection, primary action, live status. Its rarity is its signal value.

This system explicitly rejects: consumer-app gradient palettes, glassmorphism cards, enterprise dashboard chrome (bloated sidebars, multi-panel layouts competing for attention), generic shadcn/UI starter aesthetics with no visual identity, and any surface that looks like it is selling something. The interface should feel like something you put to work, not something you buy.

**Key Characteristics:**
- Deep dark surfaces; tinted-neutral, never pure black
- Single electric-blue accent; used sparingly as a functional signal
- Technical values (timecodes, file paths, model names) in monospace, always
- Flat-by-default elevation; tonal stepping communicates layer, not shadow
- Motion is invisible unless its absence would confuse
- High information density; layout breathes through rhythm, not padding uniformity

## 2. Colors: The Dispatch Palette

A near-monochromatic dark field with one precise signal color. The palette is a cockpit instrument panel: everything dark and legible, one active indicator.

### Primary
- **Signal Blue** ([to be resolved during implementation — electric blue, direction: oklch ~55–60% L, high chroma, ~240° hue]): The sole accent. Used on interactive active states, primary action buttons, live pipeline indicators, and selected items. Never decorative. Its appearance means "act here" or "this is live." Approximately `#2563EB` range; final value resolved in Tailwind config at implementation.

### Neutral
- **Cockpit Black** ([to be resolved — deep near-black, slight blue tint, oklch ~8–10% L]): Primary surface background. The floor of every screen.
- **Instrument Dark** ([to be resolved — oklch ~12–14% L, same blue tint]): Sidebar, panel, and secondary surface backgrounds. One step above Cockpit Black.
- **Console Surface** ([to be resolved — oklch ~16–20% L]): Card backgrounds, input fields, elevated containers.
- **Dim Line** ([to be resolved — oklch ~22–26% L]): Dividers and borders. Barely visible; structural, not decorative.
- **Muted Text** ([to be resolved — oklch ~50–55% L]): Secondary labels, metadata, placeholder text.
- **Primary Text** ([to be resolved — oklch ~88–92% L, slight blue tint]): Body text, headings. Never pure white.

### Named Rules
**The One Signal Rule.** Signal Blue appears on ≤10% of any given screen at any time. When every interactive element is blue, nothing is active. When only one thing is blue, the user's eye goes there immediately. Rarity is function.

**The Tinted Neutral Rule.** Every neutral — backgrounds, text, dividers — carries a trace of the blue hue (chroma 0.005–0.01). Not visible in isolation. Visible in contrast with pure grays. The palette coheres because of it.

## 3. Typography: Instrument Grade

**UI Font:** [Single geometric or humanist sans-serif — font to be chosen at implementation. Candidate direction: Inter, Geist, or equivalent technical-neutral sans.]
**Mono Font:** [System monospace stack or dedicated mono — font to be chosen at implementation. Used for all technical values.]

**Character:** Clean, neutral, high legibility at small sizes and high density. The UI font carries hierarchy through weight and size alone, not styling or decoration. The mono font is a distinct register: when you see monospace, you know this is a machine value.

### Hierarchy
- **Display** (weight 600–700, ~28–32px, line-height 1.1): Page-level section titles. Used sparingly: section headings, modal titles. Not decorative.
- **Headline** (weight 600, ~20–22px, line-height 1.2): Panel headings, significant UI labels.
- **Title** (weight 500, ~15–16px, line-height 1.3): Column headers, group labels, sidebar navigation items.
- **Body** (weight 400, ~13–14px, line-height 1.5): All prose-like content. Maximum 65–72ch line length for text-heavy areas (settings descriptions, docs).
- **Label** (weight 500, ~11–12px, line-height 1.2, letter-spacing +0.02em): Button text, tags, status badges, tab labels. Uppercase only for status indicators.
- **Mono** (monospace, ~12–13px, line-height 1.4): Timecodes, file paths, model names, API keys, any value that is a machine output. Always monospace, always.

### Named Rules
**The Mono Register Rule.** A timecode displayed in a sans-serif font is wrong. Monospace communicates "this is a machine value, not a label." Every technical string — durations, timestamps, paths, job IDs — is mono. No exceptions.

**The Weight Contrast Rule.** Adjacent typographic levels must differ by at least weight 100 or size 1.25×. A flat scale where everything is 400-weight and 14px is not a scale; it is indistinction.

## 4. Elevation

TubePilot is flat-by-default. Depth is communicated through tonal surface stepping — each layer is one OKLCH lightness step above the one beneath it — not through box shadows. Shadows as decorative depth cues do not exist in this system. The visual hierarchy is: Cockpit Black → Instrument Dark → Console Surface, each step representing a layer of UI.

Functional exception: interactive elements in lifted states (open dropdowns, floating tooltips, command palette overlay) may use a single subtle shadow to communicate modal separation from the content beneath. This shadow is structural, not ambient.

### Shadow Vocabulary
- **Floating** ([to be resolved — low-spread, mid-opacity shadow for command palette, dropdowns, tooltips]): Communicates that this surface is above the document flow. Used only for overlays, never for cards or panels.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only on floating layers that are above document flow (overlays, dropdowns, command palette). Cards, panels, and list items are never shadowed; they are differentiated by background tint. If you are reaching for a box-shadow on a card, use a background-color step instead.

## 5. Components

*Components section omitted in seed mode. Re-run `/impeccable document` once the component library (`packages/ui`) has been implemented to extract button, input, timeline editor, job card, and navigation patterns.*

## 6. Do's and Don'ts

### Do:
- **Do** use Signal Blue exclusively for active states, primary actions, and live pipeline indicators. One color, one meaning.
- **Do** render timecodes, file paths, job IDs, and model names in monospace. The monospace register communicates machine output; use it consistently.
- **Do** communicate layer through tonal surface stepping: Cockpit Black for base, Instrument Dark for panels, Console Surface for elevated containers.
- **Do** show pipeline state at all times. A job's position in the pipeline (fetching, transcribing, translating, ready, publishing) must be legible at a glance.
- **Do** prioritize information density. Power users expect to see more on a screen, not less. Design for a 27-inch desktop monitor as the primary viewport.
- **Do** use weight and size contrast to create typographic hierarchy. Minimum 1.25× size ratio or 100-weight difference between adjacent levels.
- **Do** respect `prefers-reduced-motion`. All transitions must degrade to instant state changes when the user has requested it.
- **Do** treat keyboard navigation as a first-class concern. The timeline editor, job queue, and all interactive controls must be fully operable without a mouse.

### Don't:
- **Don't** use consumer-app gradient palettes, TikTok-style colorful backgrounds, or any surface color that would look at home on a mobile entertainment app.
- **Don't** use glassmorphism: `backdrop-filter: blur` combined with semi-transparent backgrounds as a default card treatment. This is a decoration that does not exist in the system.
- **Don't** use enterprise dashboard chrome: bloated sidebars with deep nested icon trees, multi-panel layouts with 6+ visible panes, header bars stacked on header bars.
- **Don't** use the generic shadcn/UI starter aesthetic without visual identity: rounded-everything, white backgrounds, pastel accents, border cards with hover shadows.
- **Don't** use gradient text (`background-clip: text` with a gradient `background`). Emphasis is weight or size. Never gradient.
- **Don't** use `border-left` or `border-right` wider than 1px as a colored accent stripe on cards, list items, or callouts. Rewrite with a background tint or full border.
- **Don't** use the hero-metric template: a large number, a small label, supporting stats, a gradient accent. This is a SaaS landing-page pattern, not a tool pattern.
- **Don't** shadow cards or list items. Shadow only floating layers (overlays, dropdowns). If a card needs visual separation, step its background color, not its elevation.
- **Don't** design empty states with illustrations. Empty queue, no jobs running: show the URL input. The absence of work is an invitation to work, not an art moment.
- **Don't** animate layout properties (`width`, `height`, `top`, `left`, `padding`). Animate `opacity` and `transform` only.
