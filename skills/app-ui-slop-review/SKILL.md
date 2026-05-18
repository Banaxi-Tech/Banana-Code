---
name: app-ui-slop-review
description: Use this skill when the user asks whether an app, website, dashboard, screen, mockup, screenshot, or frontend UI looks like generic AI slop, needs a design quality audit, or should be reviewed for visual polish, product specificity, layout coherence, typography, color, interaction, and production readiness.
defaultAutoLoad: false
---

# App UI Slop Review

Use this skill to judge whether a UI feels generic, AI-generated, under-designed, or production-grade. Be direct, specific, and grounded in observable evidence from screenshots, browser inspection, design files, or code.

## Workflow

1. Establish the product context: audience, workflow, platform, and what the screen is supposed to help users do.
2. Inspect the UI visually whenever possible. Use browser tools or screenshots for running apps; use code only as backup when no visual surface is available.
3. Score the UI against the rubric below. Do not average away severe problems: one serious issue can make a UI feel like slop.
4. Report findings with concrete fixes. Prefer named, actionable changes over vague advice like "make it better" or "modernize it."

## Slop Signals

Flag a UI as likely AI slop when several of these are present:

- Generic SaaS composition: centered hero, vague cards, gradient blobs, repeated feature tiles, stock icon rows, no domain-specific information density.
- Weak product specificity: text and visuals could fit any app after swapping the brand name.
- Decorative excess without purpose: glow blobs, glass panels, fake charts, abstract illustrations, gradients that do not support the workflow.
- Typography defaults: system/Inter/Roboto everywhere, poor hierarchy, oversized headings inside dense tools, cramped body copy, awkward line lengths.
- Palette monotony: mostly one hue family, especially purple/blue gradients, beige/tan, dark slate, or brown/orange without clear brand or task rationale.
- Layout incoherence: nested cards, inconsistent spacing, fragile responsive behavior, text overflow, overlapping controls, unclear scan path.
- Fake functionality: controls that look clickable but have no states, dashboards with meaningless metrics, empty tools wrapped in marketing copy.
- Accessibility neglect: low contrast, tiny tap targets, focus states missing, icon-only controls without labels/tooltips, motion with no restraint.
- No real data/workflow: the first viewport sells a feature instead of letting the target user do the thing.

## Production-Grade Signals

Credit a UI when it has:

- Clear information architecture and a visible primary workflow.
- Domain-specific data, labels, controls, states, and constraints.
- Consistent spacing, alignment, responsive behavior, and component proportions.
- Typography that supports scanning and hierarchy without shouting.
- Color used for meaning, grouping, contrast, and brand rather than decoration.
- Interaction details: hover/focus/disabled/loading/empty/error states where expected.
- Visual restraint or expressive style that matches the product category.
- Evidence that the designer understood the user's repeated tasks.

## Output Format

Start with a verdict:

- `Not slop` - polished, specific, production-grade.
- `Borderline` - usable but visibly generic or unfinished.
- `AI slop` - generic, decorative, incoherent, or not meaningfully usable.

Then provide:

- `Score:` 0-10, where 10 is production-grade and 0 is unusable.
- `Why:` the strongest evidence, tied to visible UI details.
- `Fixes:` prioritized changes that would move the UI up at least two points.
- `Keep:` any parts already working well.

Be candid. Do not soften a bad UI with generic compliments. If evidence is incomplete, state what you inspected and what remains uncertain.
