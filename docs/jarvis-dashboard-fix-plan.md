# JARVIS Dashboard (DashboardView) - Comprehensive Fix Plan

## Executive Summary
The Dashboard tab (Jarvis Developer Workstation) has **three critical bugs** preventing core functionality:
1. **Jarvis Assignment Persistence Bug** - All terminals appear "assigned" after app restart, routing tasks to Jarvis instead of direct PTY execution
2. **Voice Button Not Working** - Speech-to-text requires unconfigured API keys; no fallback handling
3. **Task Input Not Executing** - Tasks appear to "stay in the text box" because of bug #1 + missing error feedback

---

## Root Cause Analysis

### Bug #1: Jarvis Assignment Persistence (CRITICAL)
**File:** `frontend/src/jarvis/agent/JarvisManager.ts` - `loadFromStorage()` method, line ~110

```typescript
// CURRENT (BUGGY):
agent.status = item.status || 'OBSERVING';  // <-- Defaults to OBSERVING!

// SHOULD BE:
agent.status = item.status || 'UNASSIGNED';  // Match JarvisAgent constructor default
```

**Impact:** 
- On first app load: terminals are UNASSIGNED (correct)
- After any Jarvis assignment + app restart: ALL saved terminals load as `OBSERVING`
- User types task → `handleDispatchTask` sees `agent.status !== 'UNASSIGNED'` → routes to `jarvisManager.assignTask()` instead of `TerminalManager.write()`
- Jarvis may fail to execute (permission issues, no auto-execution for simple commands)
- User sees task "stuck in text box" - actually sent to Jarvis but not visibly executed

### Bug #2: Voice Transcription Missing API Keys (HIGH)
**Backend:** `backend/main.py` - `_stt_provider()` function

```python
# Priority order (all require external API keys):
# 1. Task Orchestrator_STT_URL + Task Orchestrator_STT_KEY (custom)
# 2. Groq (Task Orchestrator_GROQ_API_KEY) - free tier available
# 3. OpenAI (OPENAI_API_KEY)
# 4. OpenRouter (from ~/.local/share/opencode/auth.json)
```

**Current State:** No API keys configured → `_stt_provider()` returns `{}` → `voice_transcribe` raises HTTP 503
- Web Speech API fallback exists in frontend but:
  - Only works in Chrome/Edge (not Safari/Firefox)
  - Requires HTTPS or localhost
  - No user feedback when it fails
- MediaRecorder + Whisper fallback also fails (no backend STT)

### Bug #3: Silent Failures in Task Execution (HIGH)
**File:** `frontend/src/views/dashboard/DashboardView.tsx` - `handleDispatchTask()`

```typescript
// When unassigned:
await TerminalManager.write(terminalId, `${draft}
`);
// NO .catch() user feedback if this fails!
// onToast only shows on success

// When assigned:
await jarvisManager.assignTask(terminalId, draft);
// assignTask returns boolean but not awaited properly in all paths
```

**Issues:**
- `TerminalManager.write()` catches errors but only `console.warn` - no user toast
- `jarvisManager.assignTask()` returns `Promise<boolean>` but success/failure not clearly distinguished
- Task input clears on success but NOT on failure - confusing UX
- No loading state during execution

### Bug #4: Voice UX Missing Polish (MEDIUM)
- No visual recording indicator in terminal cards (only in modal)
- Per-terminal voice button exists but hard to find (ghost icon in footer)
- No transcription progress feedback
- Modal doesn't show which terminal it's targeting clearly
- `voiceTargetTerminal` state not reset properly in all error paths

---

## Comprehensive Fix Plan

### Phase 1: Critical Bug Fixes (Do First - Unblocks Everything)

#### 1.1 Fix Jarvis Assignment Persistence
**File:** `frontend/src/jarvis/agent/JarvisManager.ts`
- Change line ~110: `agent.status = item.status || 'UNASSIGNED';`
- Add migration logic: if `item.status === 'OBSERVING'` and no explicit assignment was made, treat as UNASSIGNED
- **Verification:** After fix, fresh app load with saved data → all terminals show "UNASSIGNED"

#### 1.2 Fix Silent Terminal Write Failures
**File:** `frontend/src/views/dashboard/DashboardView.tsx` - `handleDispatchTask()`
```typescript
// Add proper error handling:
try {
  await TerminalManager.write(terminalId, `${draft}
`);
  onToast(`Executed in ${termName}`);
  setTaskDrafts(prev => ({ ...prev, [terminalId]: '' }));
} catch (err) {
  onToast(`Failed to send: ${err.message}`, true);  // RED toast
  // DO NOT clear draft on failure
}
```

#### 1.3 Fix Jarvis assignTask Error Handling
**File:** `frontend/src/jarvis/agent/JarvisManager.ts` - `assignTask()`
- Ensure it returns `false` on failure (currently returns `boolean` but may throw)
- Add try/catch in `JarvisAgent.executeCommand()` to return `false` instead of throwing

---

### Phase 2: Voice System Restoration (High Priority)

#### 2.1 Configure Groq API Key (Zero-Cost Option)
**Action Required:** User must set `Task Orchestrator_GROQ_API_KEY` environment variable
- Get free key at: https://console.groq.com/keys
- Add to shell profile or `.env` file
- **Alternative:** Document how to use OpenRouter key from opencode auth

#### 2.2 Improve Voice Fallback Chain
**File:** `frontend/src/jarvis/voice/VoiceRouter.ts` - `transcribeAudio()`
```typescript
// Current: Only tries backend
// Improved: Try Web Speech API first (instant, free), then backend
static async transcribeAudio(blob: Blob): Promise<string> {
  // 1. If Web Speech API already captured text, return it
  // 2. Try backend Whisper
  // 3. Return empty string with clear error reason
}
```

#### 2.3 Add Voice Status Indicators
**File:** `frontend/src/views/dashboard/DashboardView.tsx`
- Show recording state on per-terminal mic button (red pulse when recording)
- Show transcription status in modal ("Listening...", "Transcribing...", "Failed: no API key")
- Add tooltip explaining API key requirement if not configured

#### 2.4 Fix Voice Modal Terminal Targeting
- Show target terminal name prominently in modal header
- Add "Switch Terminal" button in modal
- Clear `voiceTargetTerminal` on modal close (all paths)

---

### Phase 3: Task Input UX Improvements (Medium Priority)

#### 3.1 Add Loading States
**File:** `frontend/src/views/dashboard/DashboardView.tsx`
- Disable input + show spinner while task executing
- Per-terminal loading state: `const [executingTerminal, setExecutingTerminal] = useState<string | null>(null)`

#### 3.2 Improve Task Input Placeholder & Hints
- Show different placeholder based on Jarvis assignment state
- Add keyboard shortcut hint: "Enter to send, Shift+Enter for newline"

#### 3.3 Add Command History Per Terminal
- Up/Arrow keys to navigate previous commands per terminal
- Store in `localStorage` keyed by terminal ID

#### 3.4 Visual Confirmation of Execution
- Brief flash animation on terminal card when command sent
- Show "Sent: <command>" in recent activity immediately

---

### Phase 4: Voice UX Polish (Lower Priority)

#### 4.1 Per-Terminal Voice Button Visibility
- Move mic button from footer to task input bar (next to Send button)
- Make it primary variant when recording, ghost when idle
- Add keyboard shortcut: `Ctrl+Space` to start voice for focused terminal

#### 4.2 Global Voice Improvements
- Show candidate terminals when ambiguous
- Allow "Hey Jarvis" wake word (optional, via Web Speech continuous mode)

#### 4.3 Transcription Editing
- Allow editing transcribed text before execution
- Show confidence score if available

---

## Implementation Checklist

### Phase 1 - Critical (Est: 30 min)
- [ ] Fix `loadFromStorage()` default status → `'UNASSIGNED'`
- [ ] Add error toast to `TerminalManager.write()` failure path in DashboardView
- [ ] Add error toast to `jarvisManager.assignTask()` failure path
- [ ] Ensure task draft only clears on SUCCESS
- [ ] Test: Fresh app → type task in unassigned terminal → executes in PTY → draft clears → toast shows

### Phase 2 - Voice (Est: 45 min + user API key setup)
- [ ] Document Groq API key setup in README/docs
- [ ] Add env var check at startup → show banner if STT not configured
- [ ] Improve Web Speech API reliability (handle Safari/FF gracefully)
- [ ] Add recording indicator on per-terminal mic button
- [ ] Add clear error messages in voice modal
- [ ] Test: Click mic → speak → transcription appears → click Execute → runs in terminal

### Phase 3 - Task UX (Est: 30 min)
- [ ] Add `executingTerminal` loading state
- [ ] Add command history (up/down arrows)
- [ ] Add execution confirmation animation
- [ ] Test: Rapid task sending works, history navigable

### Phase 4 - Voice Polish (Est: 30 min)
- [ ] Move mic button to task input bar
- [ ] Add `Ctrl+Space` shortcut
- [ ] Improve global voice disambiguation UI
- [ ] Test: Voice workflow smooth end-to-end

---

## Testing Scenarios

### Scenario 1: Fresh Install (No localStorage)
1. Open app → Dashboard tab
2. All terminals show "UNASSIGNED" status
3. Type "ls" in task input → press Enter
4. **Expected:** Command executes in terminal, toast "Executed in <name>", input clears

### Scenario 2: Returning User (Has localStorage)
1. Had previously assigned Jarvis to terminal-A
2. Close and reopen app
3. Dashboard → terminal-A should show "UNASSIGNED" (not OBSERVING)
4. Type "ls" → executes directly in PTY
5. Click "Jarvis" button → assigns Jarvis → status changes to OBSERVING
6. Type "refactor this file" → assigns to Jarvis → Jarvis executes

### Scenario 3: Voice Command (With API Key)
1. Set `Task Orchestrator_GROQ_API_KEY` in environment
2. Restart app
3. Dashboard → click per-terminal mic button
4. Speak "run tests"
5. **Expected:** Transcription appears in modal → click Execute → runs in terminal

### Scenario 4: Voice Command (Without API Key)
1. No STT provider configured
2. Click mic button → speak
3. **Expected:** Clear error "Speech-to-text not configured. Add Task Orchestrator_GROQ_API_KEY for voice commands." + fallback to text input

---

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/jarvis/agent/JarvisManager.ts` | Fix `loadFromStorage()` default status |
| `frontend/src/views/dashboard/DashboardView.tsx` | Fix `handleDispatchTask()` error handling, add loading states, voice UX improvements |
| `frontend/src/jarvis/agent/JarvisAgent.ts` | Ensure `executeCommand` returns `false` not throws |
| `frontend/src/jarvis/voice/VoiceRouter.ts` | Improve transcription fallback, error reporting |
| `backend/main.py` | (Optional) Add startup check for STT config |
| `docs/jarvis-dashboard.md` | Document voice setup, troubleshooting |

---

## Dependencies & Prerequisites

1. **Groq API Key** (free): Required for production voice transcription
   - Sign up: https://console.groq.com
   - Set: `export Task Orchestrator_GROQ_API_KEY="gsk_..."`
   
2. **Alternative:** OpenRouter key from opencode
   - Run `opencode auth login` → saves to `~/.local/share/opencode/auth.json`

3. **Web Speech API** (fallback): Works in Chrome/Edge on HTTPS/localhost only

---

## Success Criteria

✅ **All terminals show UNASSIGNED on fresh load** (no phantom assignments)
✅ **Typing task in unassigned terminal → executes in PTY immediately** (not stuck in box)
✅ **Error toast appears if PTY write fails** (not silent)
✅ **Voice button works with API key configured** (transcribes → executes)
✅ **Voice button shows helpful error without API key** (not silent failure)
✅ **Per-terminal mic button visible and accessible** (not hidden in footer)
✅ **Task input clears only on success** (preserves draft on failure)
✅ **Loading state prevents double-submission** (spinner during execution)

---

## Rollback Plan

If any fix causes regressions:
1. `git stash` the changes
2. `tauri build --bundles app` to restore previous working build
3. The bugs are non-destructive (UI only) - no data loss risk
