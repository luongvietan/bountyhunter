# Product

## Register

product

## Users

Kritt Radar is used by one trusted internal operator researching bug-bounty and
audit targets. The operator works through dense evidence, resolves ambiguous
project identities, and needs to make careful decisions without losing context.

## Product Purpose

Kritt Radar collects public bounty, audit, and repository evidence, turns it
into explainable target scores, and prepares actionable repository scopes for
Open-Kritt. The dashboard exists to review the system's uncertain decisions and
understand why a target deserves attention. Success means fewer false entity
links, faster triage, and evidence that remains traceable to source observations.

## Brand Personality

Precise, forensic, restrained. The voice is direct and operational. It names
entities, evidence, state changes, and conflicts explicitly, without marketing
language or artificial urgency.

## Anti-references

- Generic SaaS dashboards built from floating metric cards and decorative charts.
- Crypto-neon palettes, glowing gradients, and terminal cosplay.
- Consumer approval flows that hide consequences behind vague labels or modal chains.
- Editorial landing-page layouts that sacrifice scan density for oversized typography.
- Interfaces where color is the only way to distinguish pending, approved, rejected, and blocked states.

## Design Principles

1. **Evidence before action.** Show score components, entity roles, reports, programs, and repository scope before mutation controls.
2. **Make unsafe states explicit.** Ambiguity and conflicts are visible, specific, and fail closed.
3. **Preserve operator context.** URL-backed filters, stable sorting, dense labels, and history make refresh and back navigation predictable.
4. **Use familiar controls.** Native forms, links, tabs, and confirmations keep attention on the decision rather than the interface.
5. **Keep provenance legible.** Every decision should make its aliases, report movement, status, and timestamp understandable.

## Automation boundary

The default daily path is `pnpm automate` (or `scripts/automate-scheduled.ps1`):
sync evidence, auto-merge high-confidence entity candidates, dispatch top targets
to Open-Kritt, ingest findings, and auto-dismiss clear noise. The operator still
submits to bounty platforms by hand, settles outcomes, and reviews anything the
automation left pending or ambiguous.

Target WCAG 2.2 AA. All workflows must be keyboard operable, retain visible
focus, meet text and control contrast requirements, support reduced motion, and
use text plus shape or labels rather than color alone. Touch targets are at least
44px on narrow screens, and layouts must remain usable at 200% zoom.
