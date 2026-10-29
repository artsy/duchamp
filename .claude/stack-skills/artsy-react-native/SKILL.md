---
name: artsy-react-native
description: Artsy's own React Native review rules, learned from incidents in eigen and other Artsy apps. Use when reviewing a change to an Artsy React Native app.
---

# Artsy React Native rules

Rules that come from things that broke in Artsy's apps. The general skills don't
state them, or state them too softly. Each rule gives a `Severity:`. That overrides
the review prompt's default: a finding from a required rule goes inline, without a
likelihood-times-impact score.

## artsy-fast-path-animations

**Continuous animations must stay on the fast path.**

Severity: required

On the New Architecture (Fabric), Reanimated 4 updates only `transform`, `opacity` and
colours (`backgroundColor`, `color`) without committing the shadow tree. Animating any
other prop commits on every frame. That includes layout props (`width`, `height`,
`top`, `margin`, `padding`) and SVG props through `useAnimatedProps` (`strokeDashoffset`,
`strokeDasharray`, `r`, `cx`, `d`, `points`).

A short one-off transition can get away with it. A continuous one can't. Flag it when
an off-path prop is animated with `withRepeat(..., -1)` (or any loop that doesn't
end), or on more than a few elements at once. Each frame then queues commits that
starve React's own updates, and the app freezes, worst on Android.

This happened: eigen #14142 animated `strokeDashoffset` on nine SVG rects in an
infinite loop for the featured City Guide pill, and froze the app. #14254 fixed it by
rotating a static shape with `transform: rotate` instead.

Fix to suggest: keep the shape static and move it with `transform` (rotate,
translate, scale) or fade it with `opacity`, clipping with `overflow: hidden` where
needed. If the effect can't be built that way, stop the loop after one cycle, as
eigen #14297 did.

Don't flag: animating `transform`, `opacity` or colours; one-off transitions on a
single element; `useAnimatedProps` that changes only on a gesture or event rather
than every frame.

Cite as `(rule: artsy-fast-path-animations)`.
