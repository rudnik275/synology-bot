# ADR 0015: Hub-and-spoke navigation — Home hub replaces bottom tabs

## Status

Accepted (2026-06-05). Revises the IA in [ADR 0006](0006-mini-app-design-system-neo-brutalism.md) (three persistent bottom tabs + ambient header health-chip). Absorbs #203 (remove HealthChip). Composes with the G1 native-Back model (#212/#216) and the show-detail rework (#211). Triaged from #204 (G7 design).

## Context

ADR 0006 set a jobs-first IA: three persistent bottom tabs (Downloads / NAS / Shows, default Downloads) plus an ambient health-chip in every header. In use the owner disliked the bottom tab bar (look + the vertical space it costs), and separately asked to drop the header health-chip (#203, "only takes up space"). Two observations reframed the problem:

- **The three sections are not equal.** Downloads is the core job (default); NAS (health) and Shows (subscriptions) are checked occasionally. A flat 3-tab bar treats them as peers and keeps a persistent chrome element on screen at all times.
- **The app is already moving to native Telegram Back** (G1: the Add wizard drops its in-sheet header/stepper and navigates by the native BackButton). A navigation model built around native Back, rather than a persistent bottom bar, is more coherent with that direction.

## Decision

**The Mini App is hub-and-spoke. A Home hub is the root screen; the bottom tab bar is removed.**

### Hub (root)
A Home hub lists the three sections as full-width **dashboard rows**, each showing a live summary, tapped to open that section full-screen:

- **Загрузки** (primary, yellow) — active-task count + speed, with the top active download's progress bar inline.
- **NAS** (paper) — busiest-volume %, capacity bar, health dot. **This row absorbs the removed header health-chip** (#203).
- **Шоу** (paper) — new-aired-episode count, surfaced as episode chips.

Visual direction: "dashboard rows" (Variant B from the G7 prototype) — live data inside each row so the hub is informative, not an empty menu. Neo-Brutalist tokens unchanged (ADR 0006).

### Navigation & native Back
- The native Telegram **BackButton** is shown on **every screen except the hub root**; each press pops exactly **one** logical level — wizard step / folder crumb / detail → section → hub. This is the same pop-one-level model as G1 (#216), with the hub as the new root.
- On the hub, BackButton is hidden; Telegram's own close (✕) exits the app.

### Add / FAB
A global Add **FAB** sits on the **hub** and the **Downloads** section (hidden on NAS/Shows). It opens the existing full-screen Add wizard; closing returns to wherever it was opened (hub or Downloads).

### Default landing & deep-links
- A bare cold open lands on the **hub**.
- Deep-links bypass the hub straight to context (retaining ADR 0006's deep-link contract, retargeting "tab" → "section"): a push «Открыть» → the relevant section; an add-handoff (`tor-<token>`) → the Add wizard at the folder step.

### Summaries
Hub rows consume the existing composables — `useTasks` (active count/speed/top bar), `useHealth` (NAS volume %, **kept**; only the chip UI is removed per #203), `useSubscriptions` (new-episode count). They poll while the hub is visible; each section owns its own polling once entered.

## Consequences

- `TabBar.vue` + `tabs.ts` are removed; the `App.vue` shell becomes a hub + section router driven by the nav stack. The FAB moves out of the Downloads tab to a global affordance (hub + Downloads).
- **#204** is rescoped from "restyle the tab bar" to "implement hub-and-spoke IA" — large enough to split into sub-issues (hub screen + row summaries; remove tab bar / nav-stack rewire; native-Back integration with G1; FAB relocation).
- **#203** is subsumed: the health-chip is removed and its information re-homed on the hub's NAS row. `useHealth` polling stays.
- ADR 0006's IA clause (bottom tabs + ambient chip) is revised; its design system (Neo-Brutalism, tokens, motion, single light mode) is **unchanged**.
- Trade-off: switching between two sections now costs hub→section→hub→section (an extra tap vs a persistent tab bar). Accepted — the sections are unequal and occasional; the hub's at-a-glance summary is the compensating value, and deep-links bypass the hub for push-driven entry.

## Alternatives considered

- **Keep bottom tabs, just restyle** (keycap / slab / marker variants). Rejected — the owner dislikes the model itself, and it keeps persistent bottom chrome.
- **Top segmented switcher.** Rejected — frees the bottom but worsens thumb reach and still treats the three sections as equal peers.
- **Burger / drawer.** Rejected — anti-pattern for ≤5 primary destinations (HIG/MD: drawers are for secondary nav); hides top-level nav behind a tap.
- **Downloads-as-home with NAS/Shows as header buttons.** Considered — strongest for "dive straight into the job," but loses the at-a-glance dashboard the owner wanted from a hub.
