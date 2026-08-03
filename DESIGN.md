---
name: Kritt Radar
description: A forensic operator console for evidence-backed target and entity review.
colors:
  instrument-teal: "oklch(0.47 0.105 188)"
  instrument-teal-deep: "oklch(0.39 0.095 188)"
  canvas: "oklch(1 0 0)"
  bench-surface: "oklch(0.965 0.006 190)"
  evidence-ink: "oklch(0.20 0.018 200)"
  secondary-ink: "oklch(0.46 0.025 200)"
  rule: "oklch(0.86 0.010 200)"
  pending-amber: "oklch(0.63 0.14 65)"
  approved-green: "oklch(0.50 0.12 145)"
  rejected-red: "oklch(0.52 0.16 28)"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 430
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0.01em"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 520
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.instrument-teal}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  button-primary-hover:
    backgroundColor: "{colors.instrument-teal-deep}"
    textColor: "{colors.canvas}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.evidence-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  status-pending:
    backgroundColor: "{colors.pending-amber}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  status-approved:
    backgroundColor: "{colors.approved-green}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  status-rejected:
    backgroundColor: "{colors.rejected-red}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
---

# Design System: Kritt Radar

## Overview

**Creative North Star: "The Evidence Bench"**

The interface resembles a well-lit review desk where every object has a known
purpose: source evidence, a proposed relationship, and a deliberate decision.
It is compact without feeling compressed. Teal marks selected controls and
trusted actions; semantic colors are reserved for status.

This is a product surface, not a campaign. It rejects generic SaaS metric cards,
crypto neon, terminal cosplay, and editorial hero composition. Familiar controls
and precise labels let the operator focus on entity evidence.

**Key Characteristics:**

- Flat, ruled surfaces with structural spacing rather than decorative shadows.
- Dense evidence rendered in a stable sans and tabular mono data face.
- One restrained teal action color plus explicit semantic states.
- Responsive structure, consistent type sizes, and state-driven motion only.

## Colors

Pure white keeps long review sessions clear; cool teal instruments and high-
contrast ink carry the product identity.

### Primary

- **Instrument Teal**: selected navigation, focus, and trusted primary actions.
- **Deep Instrument Teal**: hover and active state for primary controls.

### Secondary

- **Pending Amber**: unresolved evidence and pending status only.
- **Approved Green**: completed approval states only.
- **Rejected Red**: rejected or destructive state, never decoration.

### Neutral

- **Canvas**: the page background and text on saturated controls.
- **Bench Surface**: secondary toolbars, evidence wells, and inactive regions.
- **Evidence Ink**: all primary text.
- **Secondary Ink**: metadata that still meets body-text contrast requirements.
- **Rule**: dividers and control outlines.

**The Evidence Color Rule.** Color always communicates a current state or an
available action. It never fills empty space for atmosphere.

## Typography

**Display Font:** system UI sans

**Body Font:** system UI sans

**Label/Mono Font:** platform monospace

**Character:** One familiar sans family keeps the product quiet and consistent.
Monospace is reserved for scores, IDs, repository keys, and timestamps.

### Hierarchy

- **Title** (720, 1.75rem, 1.15): the single route heading.
- **Section title** (700, 1.125rem, 1.25): candidate identity and evidence groups.
- **Body** (430, 0.9375rem, 1.55): descriptions and consequences, capped at 72ch.
- **Label** (650, 0.8125rem, 1.3): controls, statuses, and compact field names.
- **Data** (520, 0.8125rem, 1.4): scores and provenance values.

**The One Scale Rule.** Product type uses fixed sizes. Responsive behavior changes
layout, not heading size.

## Elevation

The system is flat by default. Depth comes from white against the Bench Surface,
one-pixel rules, and selected-state fills. Shadows are prohibited on evidence
containers; native focus outlines are the only element allowed to sit visually
above the plane.

**The Flat Bench Rule.** If a container needs a large shadow to be understood,
its hierarchy or spacing is wrong.

## Components

### Buttons

- **Shape:** compact, gently squared corners (8px), minimum 44px touch height.
- **Primary:** Instrument Teal with Canvas text, used only for confirmed approval.
- **Hover / Focus:** deeper teal on hover; 2px teal outline with 2px offset on focus.
- **Secondary:** white or Bench Surface with an Evidence Ink label and Rule outline.
- **Disabled:** neutral surface, secondary text, and no motion or misleading color.

### Chips

- **Style:** compact 4px corners; status text is always written out.
- **State:** saturated fills use Canvas text; repository chips use neutral surfaces
  and data typography.

### Cards / Containers

- **Corner Style:** restrained corners (8px or 12px).
- **Background:** Canvas for candidates, Bench Surface for nested evidence wells.
- **Shadow Strategy:** none.
- **Border:** one-pixel Rule only where it separates interactive candidates.
- **Internal Padding:** 16px narrow, 24px desktop.

### Inputs / Fields

- **Style:** native checkbox and form semantics, 8px outline controls.
- **Focus:** visible teal outline independent of color fill.
- **Error / Disabled:** explicit text accompanies state and remains keyboard-readable.

### Navigation

Status tabs are ordinary links with count badges. The active tab uses Evidence Ink
and a solid bottom rule; inactive tabs remain Secondary Ink with a clear hover.
On mobile they wrap rather than becoming a hidden menu.

### Candidate Evidence Row

A stable score rail leads into source and target identities. The component meters,
reports, programs, and repository scopes follow reading order. Mutation controls
come last, after consequences and blocking reasons.

## Do's and Don'ts

### Do:

- **Do** use pure white and cool neutral surfaces to support dense evidence.
- **Do** reserve Instrument Teal for trusted actions, selection, and focus.
- **Do** label pending, approved, rejected, and blocked states in text.
- **Do** use repository keys, timestamps, and scores in tabular monospace.
- **Do** preserve native controls, keyboard order, and 44px touch targets.

### Don't:

- **Don't** build generic SaaS dashboards from floating metric cards and decorative charts.
- **Don't** use crypto-neon palettes, glowing gradients, or terminal cosplay.
- **Don't** hide approval consequences behind vague labels or chained modals.
- **Don't** use editorial landing-page composition or oversized display typography.
- **Don't** use color as the only state distinction.
- **Don't** add side-stripe accents, glass effects, gradient text, or wide ghost-card shadows.
