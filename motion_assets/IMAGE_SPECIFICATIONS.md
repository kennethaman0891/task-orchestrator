# Exact Image Assets Required for Task Orchestrator Video
> Place your images in `motion_assets/`.
> Once placed, run `python3 scripts/render_motion_graphics.py` to compile the 1080p master video.

---

### Current Status of Scene Assets:

| # | Asset File | Status | Description |
|---|---|---|---|
| **1** | `01_session_chaos.png` | ⏳ **Awaiting From You** | Multi-agent chaotic terminal sessions (overcrowded terminal windows). |
| **2** | `02_grid_overview.png` | ✅ **Loaded (`2294 × 1490`)** | Task Orchestrator dynamic grid (multi-pane layout) + floating notch controller. |
| **3** | `03_cyber_city.png` | ✅ **Loaded (`2294 × 1490`)** | Live GitHub render of 3D Developer City (`task-orchestrator/docs/city-overview.png`). |
| **4** | `04_terminal_call.png` | ⏳ **Awaiting From You** | **Terminal Voice Call view:** The active terminal with the Call Overlay / CallView showing an in-progress voice call with the agent. |
| **5** | `05_badge_logo.png` | ⏳ **Awaiting From You** | Isolated Task Orchestrator app icon / logo badge (transparent PNG). |

---

### Instructions for Scene 4: `04_terminal_call.png`
* **Target Path:** `motion_assets/04_terminal_call.png`
* **Resolution:** `1920 × 1080` (or `2294 × 1490` Retina)
* **What to capture:**
  * Open Task Orchestrator and initiate a **Voice Call** with a terminal (using the CallOverlay / CallView component).
  * Capture the active call state showing:
    - The live green indicator (`Voice call`)
    - Call timer / duration (e.g. `01:24`)
    - Speaking / listening status (`Claude is speaking...` or `Listening...`)
    - Audio waveform / mute / volume controls docked over the terminal session.
