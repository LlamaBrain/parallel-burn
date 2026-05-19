# ADR-0005: Server-Sent Events, not WebSocket

- **Status:** Accepted
- **Date:** 2026-05-19
- **Spec impact:** [SPEC.md](../SPEC.md) §9.3
- **Supersedes:** the WS-specific wording in SPEC.md §9.3

## Context

SPEC.md §9.3 lists `WS /ws — push-on-change subscription for overlay
consumers` as one of the four endpoints the localhost server exposes. The
goal is to let the OBS browser-source overlay redraw whenever today's
aggregate changes.

Implementing a WebSocket server in Node requires either:

1. Adding a runtime dependency (`ws` is the canonical choice — small,
   well-maintained, zero transitive deps).
2. Hand-rolling RFC 6455 framing (annoying, error-prone, and not worth
   the discipline).

Both options carry costs the rest of the project has been careful to
avoid. Section 5 of the spec is explicit: "No framework dependencies for
HTTP. Built-in `node:http` is sufficient."

The overlay's actual communication pattern is **one-way, server → client,
push-on-change**. WebSocket is bidirectional and binary-capable; we use
none of that capability.

## Decision

Use **Server-Sent Events (SSE)** instead of WebSocket. The localhost
server exposes:

- `GET /events` — `Content-Type: text/event-stream`. Each push is one
  JSON-encoded `data:` event ending in `\n\n`. The client uses the
  standard browser `EventSource` API; no library required on either
  side.

SSE meets every requirement of the overlay use case:

- **Push-on-change**: ✓ — same as WS.
- **One-way server → client**: ✓ — matches the actual data flow.
- **Auto-reconnect**: ✓ — built into `EventSource`; the overlay
  reconnects automatically if the server restarts.
- **Plain HTTP**: ✓ — works through any HTTP-aware intermediary, no
  upgrade dance.
- **Zero dependencies**: ✓ — pure `node:http` on the server side, pure
  `EventSource` on the client side.

The endpoint is named `/events` rather than `/ws` because the path
should describe the protocol it serves. Renaming is a courtesy to
anyone reading the URL and expecting WebSocket semantics.

## Consequences

- **No runtime dependency added.** The `dependencies` block of
  `package.json` stays empty through Phase 7. The discipline holds.
- **The OBS browser source is one-line simpler.** A plain
  `<script>new EventSource("...")</script>` versus a WebSocket
  reconnection-handling wrapper.
- **No bidirectional control channel for the overlay.** If we ever
  want the overlay to *send* commands back (e.g. "snapshot now",
  "highlight session X"), SSE alone is not enough. We can either add a
  small `POST /control` endpoint then, or switch to WS at that point —
  a decision the future ADR can make with the actual use case in hand.
- **Documented divergence from the spec.** The spec was prescriptive
  about WS but agnostic about *what we're really trying to do* (push
  metrics to a browser source). This ADR makes the call.

## Alternatives considered

- **`ws` library.** The path of least surprise relative to the spec's
  wording. Rejected for the same reason every other dependency in this
  project is rejected: the engineering cost is non-zero, and the
  capability is not used.
- **Long polling.** Higher latency, more server load, no real benefit
  over SSE. Rejected.
- **Hand-rolled WS.** RFC 6455 framing is straightforward but tedious;
  a hire-me artifact shouldn't have a hand-rolled WS implementation
  unless we *need* it.
