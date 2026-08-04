---
name: Kritt Radar
description: A forensic operator console for evidence-backed target and entity review.
colors:
  ember: "#e7000b"
  ember-deep: "#b8000a"
  ember-soft: "#fdeceb"
  page: "#f5f5f5"
  canvas: "#ffffff"
  bench: "#fafafa"
  bench-strong: "#ebebeb"
  ink: "#0a0a0a"
  ink-soft: "#171717"
  ink-secondary: "#595959"
  ink-quiet: "#737373"
  rule: "#e5e5e5"
  danger-ink: "#a3000a"
typography:
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.75px"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.2px"
  data:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  md: "6px"
  lg: "10px"
  xl: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.canvas}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  status-pending:
    backgroundColor: "{colors.ember-soft}"
    textColor: "{colors.danger-ink}"
    border: "1px solid {colors.ember}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  status-approved:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  status-rejected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-quiet}"
    border: "1px dashed {colors.ink-quiet}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
---

# Design System: Kritt Radar

## Overview

**Creative North Star: "The Evidence Bench"**

The interface resembles a well-lit review desk where every object has a known
purpose: source evidence, a proposed relationship, and a deliberate decision.
It is compact without feeling compressed. Ember marks what still needs the
operator's attention; everything settled is neutral.

This is a product surface, not a campaign. It rejects generic SaaS metric cards,
crypto neon, terminal cosplay, and editorial hero composition. Familiar controls
and precise labels let the operator focus on entity evidence.

**Key Characteristics:**

- Two neutral surfaces: a grey page behind, white paper carrying evidence.
- Dense evidence rendered in Geist with a tabular Geist Mono data face.
- One accent, reserved for attention and selection, never for confirmation.
- Responsive structure, consistent type sizes, and state-driven motion only.

## Colors

The palette is neutral by default. A single ember accent carries every signal
that something is unresolved, so a scan of the page finds open work by colour
and finds everything else by reading.

### Accent

- **Ember**: pending status, focus rings, the selected tab, and score fills.
- **Ember Deep / Soft**: hover weight and the tinted ground beneath pending marks.

**Ember never fills a confirmation control.** Approve is the one button that
writes durable data; a red confirm reads as danger rather than intent, so the
approve action is Ink and reads as deliberate weight instead of alarm.

### Neutral

- **Page**: the grey behind everything, so paper reads as an object on a desk.
- **Canvas**: the white of evidence surfaces and text on ink-filled controls.
- **Bench / Bench Strong**: score rails, nested wells, and disabled fills.
- **Ink / Ink Soft**: primary text and the primary action fill.
- **Ink Secondary**: metadata and muted body copy that still meets AA.
- **Ink Quiet**: large or decorative greys only.
- **Rule**: dividers and control outlines.

**The Contrast Floor.** Ink Secondary is `#595959`, not the lighter grey the
token set originally carried. At 4.35:1 on the page surface that lighter grey
misses AA, and this console is almost entirely small labels. Ink Quiet keeps the
lighter value for text that is large or non-essential.

**The Evidence Color Rule.** Color always communicates a current state or an
available action. It never fills empty space for atmosphere.

## Typography

**Display Font:** Geist

**Body Font:** Geist

**Label/Mono Font:** Geist Mono

**Character:** One family across headings, labels, and controls keeps the product
quiet. Monospace is reserved for scores, IDs, repository keys, and timestamps,
where tabular figures let values line up down a column.

### Hierarchy

- **Title** (600, 30px, 1.2, -0.75px): the single route heading.
- **Subheading** (600, 18px, 1.56): candidate identity and evidence groups.
- **Body** (400, 14px, 1.43): descriptions and consequences, capped at 70ch.
- **Label** (600, 12px, 1.33, 0.2px): controls, statuses, and compact field names.
- **Data** (500, 13px, 1.4): scores and provenance values, tabular.

**The One Scale Rule.** Product type uses fixed sizes. Responsive behavior changes
layout, not heading size.

## Elevation

One elevation exists and only candidate cards use it. The shadow token already
carries its own one-pixel ring, so nothing that uses it also draws a border:
pairing the two is the ghost-card look. Everything else separates with rules and
spacing.

**The Single Elevation Rule.** If a container needs more depth than the one
shadow to be understood, its hierarchy or spacing is wrong.

## Components

### Buttons

- **Shape:** 10px corners, minimum 44px touch height.
- **Primary:** Ink with Canvas text, used for the approval that writes evidence.
- **Hover / Focus:** Ink Soft on hover; 2px ember outline at 3px offset on focus.
- **Secondary:** Canvas with an Ink label and a Rule outline.
- **Reject:** secondary until hover, then an ember outline over Ember Soft, since
  the decision is real even though it changes no durable evidence.
- **Disabled:** Bench Strong fill with Ink Secondary text. The fill says "not
  yet"; the label stays legible because the operator reads it while deciding.

### Chips

- **Style:** 6px corners; status text is always written out.
- **Pending:** Ember Soft fill inside a solid ember border.
- **Approved:** solid Ink fill, no border.
- **Rejected:** dashed grey outline over Canvas, nothing filled in.

Each state differs in fill and border as well as wording, so it survives
greyscale, low vision, and print.

### Cards / Containers

- **Corner Style:** 14px on candidate cards.
- **Background:** Canvas for candidates, Bench for nested evidence wells.
- **Shadow Strategy:** the single subtle elevation, on candidate cards only.
- **Border:** none where the shadow is used; a one-pixel Rule elsewhere.
- **Internal Padding:** 16px narrow, 24px desktop.

### Inputs / Fields

- **Style:** native checkbox and form semantics.
- **Focus:** visible ember outline independent of color fill.
- **Error / Disabled:** explicit text accompanies state and remains keyboard-readable.

### Navigation

Status tabs are ordinary links with count badges. The active tab uses Ink text
over a solid ember bottom rule; inactive tabs remain Ink Secondary with a clear
hover. On mobile they wrap rather than becoming a hidden menu.

### Candidate Evidence Row

A stable score rail leads into source and target identities. The component meters,
reports, programs, and repository scopes follow reading order. Mutation controls
come last, after consequences and blocking reasons.

## Do's and Don'ts

### Do:

- **Do** keep surfaces neutral so the one accent stays meaningful.
- **Do** reserve Ember for attention, selection, and focus.
- **Do** label pending, approved, rejected, and blocked states in text.
- **Do** use repository keys, timestamps, and scores in tabular monospace.
- **Do** preserve native controls, keyboard order, and 44px touch targets.

### Don't:

- **Don't** colour the approve control with the accent; red confirms read as danger.
- **Don't** pair the elevation shadow with a border on the same element.
- **Don't** build generic SaaS dashboards from floating metric cards and decorative charts.
- **Don't** hide approval consequences behind vague labels or chained modals.
- **Don't** use color as the only state distinction.
