# ADR 0001: Build StackReel from scratch instead of forking OpenCut

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

We want a free, open-source, on-device editor for portrait (9:16) video that runs on mobile, web, and desktop,
and is template-first rather than timeline-first. OpenCut (MIT) was the obvious fork candidate.

As of October 2026:

- `opencut-app/opencut-classic` (Next.js, web-only) was **archived on 2026-05-17**, frozen mid-migration from TypeScript to Rust.
- `opencut-app/opencut` is a **ground-up rewrite on a Rust core** and does not yet accept outside contributions while the architecture is designed.
- OpenCut's UX is a CapCut-desktop-style multi-track timeline. Ours is template-first.
- Our team's skills are TypeScript/React and native mobile, not Rust.
- We do not intend to track upstream.

## Decision

Build StackReel from scratch. Do not hand-write codecs or a media engine. Build on each platform's
hardware-accelerated media frameworks (AVFoundation/Metal, Media3/MediaCodec, WebCodecs/WebGL),
tied together by a single JSON template format.

## Consequences

- We own the architecture and can design for templates, vertical video, and mobile from day one.
- We carry the cost of building a timeline/render model ourselves, which Phase 1 scopes small.
- We may still reuse MIT-licensed code from OpenCut with attribution, and revisit its headless renderer once it is stable.
