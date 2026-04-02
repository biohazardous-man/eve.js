<!--
Proof-of-authorship note: Primary authorship and project direction for this project document belong to John Elysian.
This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
If you reuse, discuss, or share this file, please credit it accurately.
-->

Extra note: Implementing Tidi in the server was the easy part. Activating it natively, on the client? Ha. You'll spend £1000 on AI going in circles, before finding the solution. I tried. After many days, I figured it out. Essentially: CCP lets you patch the client code during login in the handshake, it's how they do a LOT of their dev functionality, and hilariously the best I can tell, is also how they set the flag in the client in blue.dll to simply "be allowed to ever use tidi / respond to server tidi requests"!

# Time Dilation (TiDi) — Full Technical Writeup

Updated: 2026-03-17

## Overview

EvEJS implements native per-solar-system Time Dilation (TiDi) that uses the stock
EVE client's built-in TiDi HUD indicator with **zero client-side file modifications**.
The server controls everything: blue.dll's TiDi tick loop is started during login,
and dilation parameters are pushed at runtime via standard machoNet notifications.

This is, to our knowledge, the first documentation of how CCP's client-side TiDi
activation actually works at the protocol level.

---

## How CCP's Client TiDi Works

### The TiDi HUD

The stock EVE client ships with a TiDi indicator widget:
- `eve/client/script/ui/inflight/tidiIndicator.py`
- Mounted in the inflight location info panel header
- Polls `blue.os.desiredSimDilation` on a timer
- Becomes visible when `desiredSimDilation < 0.98`
- Animates ring color/fill based on the factor value

### blue.dll Native TiDi Subsystem

`blue.dll` contains a complete native TiDi subsystem with these Python-exposed APIs:

| API | Type | Description |
|-----|------|-------------|
| `blue.os.EnableSimDilation(offset)` | Function | Starts blue.dll's internal TiDi tick loop. "What is done cannot be undone." |
| `blue.os.desiredSimDilation` | Read-only property | The desired TiDi factor. Set natively by blue.dll. Read by the TiDi HUD. |
| `blue.os.simDilation` | Read-only property | The current actual TiDi factor. |
| `blue.os.maxSimDilation` | **Writable** property | Maximum allowed factor (default 1.0). |
| `blue.os.minSimDilation` | **Writable** property | Minimum allowed factor (default 0.1). |
| `blue.os.dilationOverloadThreshold` | **Writable** property | CPU threshold for dilation (default 100000000). |
| `blue.os.dilationOverloadAdjustment` | **Writable** property | Overload adjustment factor (default 0.8254). |
| `blue.os.dilationUnderloadThreshold` | **Writable** property | Underload threshold (default 20000000). |
| `blue.os.dilationUnderloadAdjustment` | **Writable** property | Underload adjustment factor (default 1.059254). |
| `blue.os.RegisterClientIDForSimTimeUpdates(clientID)` | Function | Registers a client for sim time updates. |
| `blue.os.UnregisterClientIDForSimTimeUpdates(clientID)` | Function | Unregisters a client. |

### The Key Discovery

`desiredSimDilation` and `simDilation` are **read-only from Python** — they can only
be set by blue.dll's native C++ code. However, the writable threshold and limit
parameters control how blue.dll's tick loop *decides* what `desiredSimDilation` should be.

Once `EnableSimDilation(0)` starts the tick loop:
- Setting `dilationOverloadThreshold = 0` makes blue.dll think CPU is always overloaded
- Setting `maxSimDilation = 0.5` and `minSimDilation = 0.5` locks the factor at 0.5
- blue.dll's tick loop natively lowers `desiredSimDilation` to 0.5
- The TiDi HUD sees `desiredSimDilation < 0.98` and appears

To disable TiDi in a deterministic multi-client way, force full speed:
`maxSimDilation = 1.0`, `minSimDilation = 1.0`,
`dilationOverloadThreshold = 100000000`. That avoids per-client recovery drift when
one client is busier than another while clearing TiDi.

---

## How EvEJS Activates TiDi

### Step 1: Login — signedFunc Handshake Code Execution

During the TCP handshake, CCP's `GPS.py` protocol includes a `signedFunc` field that
the client evaluates:

```
GPS.py __Execute() → Crypto.Verify(signedFunc) → eval(marshal.loads(data))
```

With placebo crypto (`start.ini`), `Crypto.Verify` always passes. The server sends
a marshaled Python string that the client `eval()`s during login.

EvEJS exploits this by sending:

```python
eval(compile("<multi-line-python-code>", "<tidi>", "exec"))
```

The `compile()` with `exec` mode allows full multi-statement Python including class
definitions, try/except, imports — all inside a single `eval()` expression.

**What the signedFunc code does:**

```python
import blue
blue.os.EnableSimDilation(0)          # Start blue.dll's TiDi tick loop

class _TiDiHandler(object):           # Define notification handler
    __guid__ = 'svc.tidiHandler'
    __notifyevents__ = ['OnSetTimeDilation']
    def OnSetTimeDilation(self, maxD, minD, thresh):
        import blue
        blue.os.maxSimDilation = float(maxD)
        blue.os.minSimDilation = float(minD)
        blue.os.dilationOverloadThreshold = int(thresh)

_h = _TiDiHandler()
sm.RegisterForNotifyEvent(_h, 'OnSetTimeDilation')  # Register with CCP's service manager
__builtins__['__tidiHandler'] = _h                   # Prevent garbage collection
```

This runs once per login. No TiDi is forced — the tick loop starts but with default
params (threshold=100000000), so `desiredSimDilation` stays at 1.0.

**Marshal format:** The Python code is wrapped in a Python 2.7 marshal interned string:
`0x74` (type tag) + `int32LE(length)` + ASCII bytes.

### Step 2: Runtime — /tidi Command

When `/tidi <factor>` is used in chat:

1. **2-second synchronized delay:** The server schedules both the client notification
   and the server factor change to fire together after a 2-second delay. This matches
   CCP's published dev blog behavior where all participants transition simultaneously.

2. **After 2s — Client notification:** Server sends `OnSetTimeDilation` machoNet
   notification to all sessions in the solar system. CCP's `BroadcastStuffGPCS`
   dispatches it to our registered `_TiDiHandler` via `sm.ScatterEvent`.

3. **After 2s — Server factor change:** In the same tick, the server applies the new
   `scene.timeDilation` factor. Clients and server transition at exactly the same moment.

**Notification payload:** `[maxDil, minDil, threshold]`
- factor < 1.0: `[factor, factor, 0]` — locks dilation, forces overload
- factor = 1.0: `[1.0, 0.1, 100000000]` — restores defaults, disables TiDi

### Step 3: System Entry/Leave

- **Entering a TiDi system:** `ensureInitialBallpark()` sends `OnSetTimeDilation`
  with the scene's current factor to the arriving client
- **Leaving a TiDi system:** `detachSession()` sends `OnSetTimeDilation` with
  factor=1.0 to reset the client's TiDi state

---

## Server-Side Time Dilation

### Per-Scene Simulation Clock

Each `SolarSystemScene` maintains:
- `timeDilation` — current factor (0.1 to 1.0)
- `simTimeMs` — accumulated simulation time
- `lastWallclockTickAt` — last wallclock tick timestamp

Each server tick: `simDelta = wallclockDelta * timeDilation`

This affects:
- Ship movement (subwarp velocity integration)
- Warp progression (elapsed sim time curves)
- Destiny stamp advancement
- Module cycle timing
- DoSimClockRebase notifications to clients

### Clock Rebase on Return to 1.0

When TiDi is disabled (factor returns to 1.0), `setTimeDilation()` snaps `simTimeMs`
back to wallclock time. Without this, accumulated drift from the dilated period would
leave all timestamps behind, causing module radial desync, destiny stamp mismatches,
and visible position snaps.

---

## Notification Flow Through CCP's Client

The machoNet notification path:

```
Server: session.sendNotification("OnSetTimeDilation", "clientID", [maxD, minD, thresh])
   |
   v
Client machoNet: receives NOTIFICATION packet
   |
   v
BroadcastStuffGPCS.NotifyUp(): checks payload[0] == 1 (RPC mode)
   |
   v
sm.ScatterEventWithoutTheStars("OnSetTimeDilation", [maxD, minD, thresh])
   |
   v
ServiceManager: iterates self.notify["OnSetTimeDilation"]
   |
   v
_TiDiHandler.OnSetTimeDilation(maxD, minD, thresh)
   |
   v
blue.os.maxSimDilation = maxD
blue.os.minSimDilation = minD
blue.os.dilationOverloadThreshold = thresh
   |
   v
blue.dll tick loop: detects overload (threshold=0), adjusts desiredSimDilation
   |
   v
TiDi HUD: polls desiredSimDilation < 0.98, becomes visible
```

---

## What We Tried That Didn't Work

### Native BlueNet TiDi Frames

blue.dll has a native BlueNet transport layer for TiDi events using three "kinds":
- INIT (0x001658A0) — establishes a TiDi master
- EVENT (0x001658B7) — sends factor updates
- DETACH (0x009E3144) — tears down TiDi

We fully reverse-engineered the wire format (bit-packed varints, raw doubles) and
built a complete encoder in `server/src/network/nativeTimeDilation.js`. The frames
were correctly parsed by the client — but **no callback was registered for the kinds**,
so they were silently discarded with "did not match a callback for delivery".

Even after calling `EnableSimDilation(0)` and `RegisterClientIDForSimTimeUpdates(clientId)`
during login, the BlueNet kind callbacks were never registered on the client side.
This suggests those callbacks are only registered on the CCP server's blue.dll instance,
not on the client's.

### Direct Property Writes

`blue.os.desiredSimDilation = 0.5` fails with "Python property 'desiredSimDilation'
is read-only". Same for `simDilation`. These properties can only be set by blue.dll's
native C++ code.

### DoSimClockRebase Alone

Sending `DoSimClockRebase` notifications does rebase client timers, but it does NOT
set `desiredSimDilation` and does NOT make the TiDi HUD appear. It's necessary for
timestamp coherence but insufficient for visual TiDi.

### Live Updates System

CCP's `liveUpdateMgr` can execute arbitrary Python on clients, but
`LiveUpdateSvc.Enabled()` returns `False` in this client build.

---

## File Reference

| File | Role |
|------|------|
| `server/src/network/tcp/handshake.js` | `buildTidiSignedFunc()` — generates the login Python code |
| `server/src/services/chat/chatCommands.js` | `/tidi` command, `sendTimeDilationNotificationToSession/System` helpers |
| `server/src/space/runtime.js` | Per-scene `setTimeDilation()`, system entry/leave notifications |
| `server/src/network/nativeTimeDilation.js` | Dead code — old BlueNet frame encoder (kept for reference) |

---

## How to Revert

1. In `server/src/network/tcp/handshake.js`, find:
   ```js
   [buildTidiSignedFunc(this.clientId), false], // func tuple
   ```
   Change to:
   ```js
   [MARSHALED_NONE, false], // func tuple: [marshaled_code, verification]
   ```

2. Restart the server. Clients that reconnect will no longer have the TiDi handler
   installed. `/tidi` will still set server-side sim time but the client HUD won't respond.

All TiDi-related changes are marked with `//testing` comments for easy identification.

---

## Research History

### Key Discoveries (chronological)

1. **blue.dll string analysis** revealed native TiDi APIs (`EnableSimDilation`,
   `desiredSimDilation`, etc.) and BlueNet TiDi kind IDs (INIT/EVENT/DETACH)

2. **BlueNet wire protocol reverse-engineering** from blue.dll disassembly: bit-packed
   varints, raw doubles, `0x10000000` flag in TCP length prefix

3. **signedFunc mechanism** in GPS.py handshake: server can execute arbitrary Python
   on the client during login via marshaled code + placebo crypto

4. **`desiredSimDilation` is read-only** from Python: direct property write fails.
   Only blue.dll's native code can set it.

5. **BlueNet kind callbacks not registered on client**: Even after `EnableSimDilation`
   + `RegisterClientIDForSimTimeUpdates`, native BlueNet TiDi frames were discarded.
   The callback registration only happens on CCP's server-side blue.dll.

6. **The breakthrough**: `EnableSimDilation(0)` starts blue.dll's TiDi tick loop.
   Setting writable params (`dilationOverloadThreshold=0`, `maxSimDilation=factor`,
   `minSimDilation=factor`) forces the tick loop to natively lower `desiredSimDilation`.
   This is how we control the read-only property without direct writes.

7. **Notification handler via signedFunc**: `sm.RegisterForNotifyEvent` registers a
   Python handler during login that responds to standard machoNet notifications at
   runtime. This gives the server runtime control over client TiDi.
