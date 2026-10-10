"""TTO Discord Bot — 1:1 remote control for the Agent Workspace section.

Slash commands only (no prefix commands).  Every handler is thin:
parse args → call bridge function → format reply.  Zero business logic here.

Requires discord.py 2.x: pip install discord.py>=2.3
Environment: DISCORD_BOT_TOKEN must be set in .env.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional

import discord
from discord import app_commands
from discord.ext import commands

log = logging.getLogger("tto.discord")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)-8s] %(name)s: %(message)s")

# ── Bridge (populated by main.py before launch) ─────────────────────────────
_bridge: Dict[str, Any] = {}


def register_bridge(bridge: Dict[str, Any]) -> None:
    """Called by main.py to inject the bridge dict before the bot starts."""
    global _bridge
    _bridge = bridge


def _b(name: str):
    """Fetch a bridge callable."""
    fn = _bridge.get(name) if isinstance(_bridge, dict) else getattr(_bridge, name, None)
    return fn




def _is_session_not_in_workspace(exc: Exception) -> bool:
    """Check if an exception is SessionNotInWorkspace (from main.py).

    We can't import the class directly due to the circular import between
    main.py → discord_bot → main.py.  Instead, duck-type check for the
    attributes that SessionNotInWorkspace carries.
    """
    return hasattr(exc, "n") and hasattr(exc, "ws")


# ── Color constants ─────────────────────────────────────────────────────────
COLOR_RUNNING = discord.Color(0xFF8C00)   # orange
COLOR_IDLE    = discord.Color(0x808080)   # grey
COLOR_DONE    = discord.Color(0x00CC66)   # green
COLOR_ERROR   = discord.Color(0xCC0000)   # red
COLOR_PRIMARY = discord.Color(0x5865F2)   # Discord blurple


# ── Helper: status color ────────────────────────────────────────────────────
def _status_color(status: str) -> discord.Color:
    s = (status or "").lower()
    if s in ("running", "streaming"):
        return COLOR_RUNNING
    if s in ("completed", "done", "finished"):
        return COLOR_DONE
    return COLOR_IDLE


def _status_pill(status: str) -> str:
    s = (status or "").lower()
    if s in ("running", "streaming"):
        return "🟠 Running"
    if s in ("completed", "done", "finished"):
        return "🟢 Done"
    if s in ("error",):
        return "🔴 Error"
    return "⚪ Idle"


# ── Live status poller ──────────────────────────────────────────────────────
class _LivePoller:
    """Edits an embed in place every ~3s while a session is running.

    Respects Discord's 2s per-channel rate limit by tracking last-edit time.
    Automatically stops after 5 minutes of idle or when the session finishes.
    """

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self._tasks: dict[str, asyncio.Task] = {}  # chat_id -> task

    def start(self, message: discord.Message, chat_id: str, real_id: str,
              short_id: int, ws_name: str):
        key = f"{message.channel.id}:{short_id}"
        if key in self._tasks:
            self._tasks[key].cancel()
        self._tasks[key] = asyncio.create_task(
            self._poll_loop(message, chat_id, real_id, short_id, ws_name, key)
        )

    def stop(self, short_id: int, channel_id: int):
        key = f"{channel_id}:{short_id}"
        task = self._tasks.pop(key, None)
        if task:
            task.cancel()

    async def _poll_loop(self, message: discord.Message, chat_id: str,
                         real_id: str, short_id: int, ws_name: str, key: str):
        start = time.time()
        last_edit = 0.0
        try:
            while time.time() - start < 300:  # 5 min max
                await asyncio.sleep(3)
                # Rate limit: at least 2s between edits
                now = time.time()
                if now - last_edit < 2.0:
                    continue
                try:
                    session_fn = _b("agent_session")
                    if not session_fn:
                        break
                    summary = await session_fn(real_id)
                    embed = _build_session_embed(summary, short_id, ws_name)
                    await message.edit(embed=embed)
                    last_edit = time.time()
                    # Stop if session finished
                    status = (summary.get("status") or "").lower()
                    if status in ("completed", "done", "finished", "error"):
                        break
                except Exception:
                    break
        except asyncio.CancelledError:
            pass
        finally:
            self._tasks.pop(key, None)


# ── Embed builders ──────────────────────────────────────────────────────────

def _build_workspaces_embed(workspaces: list) -> discord.Embed:
    """Build the /workspaces embed with numbered buttons."""
    embed = discord.Embed(
        title="AGENT WORKSPACES",
        description="Select a workspace to dock into:",
        color=COLOR_PRIMARY,
    )
    if not workspaces:
        embed.description = "No workspaces found."
        return embed
    lines = []
    for i, ws in enumerate(workspaces, 1):
        name = ws.get("name") or ws.get("id") or f"workspace-{i}"
        path = ws.get("projectPath") or ""
        short_path = "/".join(path.split("/")[-2:]) if path else ""
        lines.append(f"**#{i}** {name}" + (f"  `{short_path}`" if short_path else ""))
    embed.add_field(name="Workspaces", value="\n".join(lines), inline=False)
    return embed


def _build_sessions_embed(sessions: list, ws_name: str) -> discord.Embed:
    """Build the /sessions embed with colored status indicators."""
    embed = discord.Embed(
        title=f"AGENT WORKSPACE — {ws_name}",
        description="Click a button to view session detail:",
        color=COLOR_PRIMARY,
    )
    if not sessions:
        embed.description = "No sessions in this workspace."
        return embed
    lines = []
    for s in sessions:
        short = s.get("short_id")
        status = (s.get("status") or "idle").lower()
        title = (s.get("title") or s.get("id") or "")[:60]
        agent = s.get("agent") or ""
        pill = _status_pill(status)
        label = f"#{short}" if short else title[:10]
        lines.append(f"{label} — {title}" + (f" ({agent})" if agent else ""))
    embed.add_field(name="Sessions", value="\n".join(lines)[:1024] or "None", inline=False)
    return embed


def _build_session_embed(summary: dict, short_id: int, ws_name: str) -> discord.Embed:
    """Build the /session <n> detail embed."""
    status = summary.get("status") or "idle"
    title = summary.get("title") or summary.get("id") or f"#{short_id}"
    agent = summary.get("agent") or "unknown"

    embed = discord.Embed(
        title=f"AGENT WORKSPACE — {ws_name}",
        description=f"**{title}**",
        color=_status_color(status),
    )
    embed.add_field(name="Status", value=_status_pill(status), inline=True)
    embed.add_field(name="Agent", value=f"`{agent}`", inline=True)
    embed.add_field(name="Session", value=f"`#{short_id}`", inline=True)

    # Todos checklist
    todos = summary.get("todos") or []
    if todos:
        checklist = []
        for t in todos:
            check = "✅" if t.get("done") else "⬜"
            text = (t.get("text") or "")[:80]
            checklist.append(f"{check} {text}")
        embed.add_field(
            name=f"TODOs ({sum(1 for t in todos if t.get('done'))}/{len(todos)} done)",
            value="\n".join(checklist)[:1024],
            inline=False,
        )

    # Last assistant text as quote block
    text = (summary.get("text") or "").strip()
    if text:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        last = paragraphs[-1] if paragraphs else text
        embed.add_field(
            name="Last Reply",
            value=f"> {last[:900]}",
            inline=False,
        )

    return embed


# ═══════════════════════════════════════════════════════════════════════════
# BUTTONS-FIRST CONTROL PANEL (replaces ALL 9 slash commands for the user)
# ═══════════════════════════════════════════════════════════════════════════
# The user never types a slash command.  Everything is a button tap.
# Slash commands still exist under the hood as the Discord interaction
# engine, but the user only sees & uses these panels.

_poller = None  # Set to _LivePoller instance inside create_bot()


def _get_docked_ws(chat_id: str) -> Optional[str]:
    """Get the docked workspace name for a chat (per-chat or global)."""
    get_chat_ws_fn = _b("agent_get_chat_ws")
    ws_name = get_chat_ws_fn(chat_id) if get_chat_ws_fn else None
    if not ws_name:
        ws_fn = _b("agent_current_ws")
        ws_name = ws_fn() if ws_fn else None
    return ws_name if isinstance(ws_name, str) and ws_name else None


def _get_workspace_list() -> list:
    """Get the list of all workspaces."""
    ws_fn = _b("agent_workspaces")
    return ws_fn() if ws_fn else []


def _friendly_error(exc) -> str:
    """Convert an exception to a human-readable error string."""
    if _is_session_not_in_workspace(exc):
        return f"❌ Session #{exc.n} not found in workspace '{exc.ws}'."
    s = str(exc)
    if "Path must be absolute" in s:
        return "❌ Project path must start with / (e.g. /Users/kennethaman/projects/my-app)"
    if "No workspaces" in s or "not found" in s.lower():
        return "❌ No workspace available. Tap 🔧 Workspaces to create one."
    if "Bridge not initialized" in s or "bridge" in s.lower():
        return "❌ Backend not ready yet. Wait a moment and try again."
    if "timed out" in s.lower() or "timeout" in s.lower():
        return "❌ Request timed out. The agent might be busy — try again in a few seconds."
    if "connection refused" in s.lower():
        return "❌ Can't reach the agent. Is the backend running?"
    if "404" in s or "not found" in s.lower():
        return "❌ Session not found. It may have been deleted — tap 📋 My Sessions to refresh."
    if "422" in s or "unprocessable" in s.lower():
        return "❌ Invalid input. Check your session name and try again."
    if "429" in s or "rate" in s.lower():
        return "❌ Too many requests. Wait a moment and try again."
    if "500" in s or "internal" in s.lower():
        return "❌ Something went wrong on the backend. Try again — if it persists, restart the server."
    return f"❌ {s[:200]}"


def _error_embed(title: str, error: str, retry_view: discord.ui.View = None) -> discord.Embed:
    """Build a friendly error embed with optional retry button."""
    embed = discord.Embed(
        title=title,
        description=error,
        color=COLOR_ERROR,
    )
    embed.set_footer(text="Tap a button to try again")
    return embed


# ── NewSessionModal ──────────────────────────────────────────────────────

class NewSessionModal(discord.ui.Modal, title="➕ New Session"):
    """Pop-up form for creating a new agent session (with project path)."""

    session_name = discord.ui.TextInput(
        label="Session name",
        placeholder="my-project",
        required=True,
        max_length=100,
    )
    project_path = discord.ui.TextInput(
        label="Project path (optional)",
        placeholder="/Users/kennethaman/projects/my-app",
        required=False,
        max_length=500,
    )
    agent = discord.ui.TextInput(
        label="Agent (optional)",
        placeholder="build",
        required=False,
        default="build",
        max_length=50,
    )

    def __init__(self, ws_name: str):
        super().__init__()
        self.ws_name = ws_name

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)

        create_fn = _b("create_agent_session")
        if not create_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return

        agent = (self.agent.value or "build").strip().lower()
        result = await create_fn(self.ws_name, agent)

        if not result.get("ok"):
            error = result.get("error", "unknown")
            if "Path must be absolute" in str(error):
                error = "❌ Project path must start with / (e.g. /Users/kennethaman/projects/my-app)"
            await interaction.followup.send(f"❌ Create failed: {error}", ephemeral=True)
            return

        short = result.get("short_id")
        embed = discord.Embed(
            title="✅ Session Created",
            description=(
                f"**{self.session_name.value}**\n"
                f"Agent: `{agent}`\n"
                f"ID: `#{short}`\n"
                f"Workspace: {self.ws_name}"
            ),
            color=COLOR_DONE,
        )
        view = _build_session_buttons(short, self.ws_name, chat_id)
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)


# ── Workspace Picker (reusable View) ─────────────────────────────────────

class _WorkspacePickerView(discord.ui.View):
    """Dropdown that lets the user pick + dock into a workspace."""

    def __init__(self, on_picked_callback=None, ephemeral=True):
        super().__init__(timeout=300)
        self._on_picked = on_picked_callback
        self._ephemeral = ephemeral
        workspaces = _get_workspace_list()
        options = [
            discord.SelectOption(
                label=f"#{i} {(ws.get('name') or ws.get('id') or f'ws-{i}')[:25]}",
                value=ws.get("name") or ws.get("id") or f"ws-{i}",
                description=f"Dock into {ws.get('name', '?')}"[:100],
            )
            for i, ws in enumerate(workspaces, 1)
        ][:25]  # Discord max 25 options
        if options:
            select = discord.ui.Select(
                placeholder="Pick a workspace to dock into...",
                options=options,
            )
            select.callback = self._select_cb
            self.add_item(select)

    async def _select_cb(self, interaction: discord.Interaction):
        selected = interaction.values[0]
        chat_id = str(interaction.user.id)
        set_ws_fn = _b("agent_set_current_ws")
        if set_ws_fn:
            set_ws_fn(selected)
        set_chat_ws_fn = _b("agent_set_chat_ws")
        if set_chat_ws_fn:
            set_chat_ws_fn(chat_id, selected)
        if self._on_picked:
            await self._on_picked(interaction, selected)
        else:
            await interaction.response.edit_message(
                content=f"✅ Docked: **{selected}**",
                embed=None,
                view=None,
            )


# ── Send Sessions List (reusable helper) ─────────────────────────────────

async def _send_sessions_list(interaction, ws_name: str, chat_id: str):
    """Show all sessions in the workspace with colored status buttons."""
    await interaction.response.defer(ephemeral=True)

    sess_fn = _b("agent_sessions")
    if not sess_fn:
        await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
        return

    result = await sess_fn()
    if not result.get("ok"):
        await interaction.followup.send(
            f"❌ Failed: {result.get('error', 'unknown')}", ephemeral=True,
        )
        return

    all_sessions = result.get("sessions", [])

    # Filter to sessions in this workspace
    get_ws_fn = _b("agent_resolve_workspace")
    ws = get_ws_fn(ws_name) if get_ws_fn else None
    ws_path = (ws.get("projectPath") or "").rstrip("/") if ws else ""
    scoped = [
        s for s in all_sessions
        if ws_path and (s.get("cwd") or "").rstrip("/").startswith(ws_path)
    ] or all_sessions

    embed = _build_sessions_embed(scoped, ws_name)
    view = discord.ui.View(timeout=300)

    for s in scoped:
        short = s.get("short_id")
        if short is None:
            continue
        status = (s.get("status") or "idle").lower()
        if status in ("running", "streaming"):
            style = discord.ButtonStyle.primary
        elif status in ("completed", "done", "finished"):
            style = discord.ButtonStyle.success
        else:
            style = discord.ButtonStyle.secondary

        async def _open_cb(bttn, n=short, ws=ws_name, cid=chat_id):
            try:
                r = _b("resolve_session")(cid, str(n))
                sess = await _b("agent_session")(r["real"])
                e = _build_session_embed(sess, n, ws)
                v = _build_session_buttons(n, ws, cid)
                await interaction.followup.send(embed=e, view=v, ephemeral=True)
            except Exception as exc:
                await interaction.followup.send(_friendly_error(exc), ephemeral=True)

        btn = discord.ui.Button(
            label=f"#{short}", style=style,
            custom_id=f"tto_sess_open_{short}",
        )
        btn.callback = _open_cb
        view.add_item(btn)

    if not scoped:
        embed.add_field(name="", value="Tap ➕ New Session to create one.", inline=False)

    await interaction.followup.send(embed=embed, view=view, ephemeral=True)


# ── Send Task Modal (reusable for Dispatch button) ───────────────────────

class _DispatchTaskModal(discord.ui.Modal, title="🚀 Send Task"):
    """Modal for sending a task to a session."""

    task_text = discord.ui.TextInput(
        label="Task description",
        style=discord.TextStyle.paragraph,
        placeholder="Describe what the agent should do...",
        required=True,
        max_length=4000,
    )

    def __init__(self, short_id: int, ws_name: str, chat_id: str):
        super().__init__()
        self.short_id = short_id
        self.ws_name = ws_name
        self.chat_id = chat_id

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        resolve_fn = _b("resolve_session")
        send_fn = _b("send_agent_task")
        if not resolve_fn or not send_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return

        try:
            resolved = resolve_fn(self.chat_id, str(self.short_id))
        except Exception as exc:
            await interaction.followup.send(_friendly_error(exc), ephemeral=True)
            return

        real_id = resolved["real"]

        async def _do_send():
            try:
                result = await send_fn(real_id, self.task_text.value)
                if result.get("ok"):
                    session_fn = _b("agent_session")
                    summary = await session_fn(real_id) if session_fn else {}
                    embed = _build_session_embed(summary, self.short_id, self.ws_name)
                    msg = await interaction.followup.send(embed=embed, ephemeral=True)
                    if _poller:
                        _poller.start(msg, self.chat_id, real_id, self.short_id, self.ws_name)
                else:
                    await interaction.followup.send(
                        f"❌ Task failed: {result.get('error', 'unknown')}", ephemeral=True,
                    )
            except Exception as exc:
                try:
                    await interaction.followup.send(_friendly_error(exc), ephemeral=True)
                except Exception:
                    pass

        asyncio.create_task(_do_send())


# ── ControlPanelView (persistent — the home screen) ──────────────────────

class ControlPanelView(discord.ui.View):
    """Always-on 4-button control panel.  Never expires (persistent)."""

    def __init__(self):
        super().__init__(timeout=None)

    # ── 🔧 Workspaces ──────────────────────────────────────────────────
    @discord.ui.button(
        label="🔧 Workspaces",
        style=discord.ButtonStyle.blurple,
        custom_id="tto_workspaces",
    )
    async def workspaces_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        workspaces = _get_workspace_list()
        if not workspaces:
            await interaction.followup.send(
                embed=discord.Embed(
                    title="No Workspaces",
                    description="No workspaces found. Create one first.",
                    color=COLOR_ERROR,
                ),
                ephemeral=True,
            )
            return
        embed = _build_workspaces_embed(workspaces)
        view = _WorkspacePickerView()
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    # ── ➕ New Session ──────────────────────────────────────────────────
    @discord.ui.button(
        label="➕ New Session",
        style=discord.ButtonStyle.green,
        custom_id="tto_new_session",
    )
    async def new_session_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        chat_id = str(interaction.user.id)
        ws_name = _get_docked_ws(chat_id)

        if not ws_name:
            await interaction.response.defer(ephemeral=True)
            workspaces = _get_workspace_list()
            if not workspaces:
                await interaction.followup.send(
                    embed=discord.Embed(title="No Workspaces", color=COLOR_ERROR),
                    ephemeral=True,
                )
                return

            async def on_picked(inter, selected):
                modal = NewSessionModal(selected)
                await inter.response.send_modal(modal)

            view = _WorkspacePickerView(on_picked_callback=on_picked)
            await interaction.followup.send(
                embed=discord.Embed(
                    title="👋 Let's pick a workspace first!",
                    description="Then we'll create a session.",
                    color=COLOR_PRIMARY,
                ),
                view=view,
                ephemeral=True,
            )
            return

        # Docked: send modal directly (fast, no bridge call needed)
        modal = NewSessionModal(ws_name)
        await interaction.response.send_modal(modal)

    # ── 📋 My Sessions ──────────────────────────────────────────────────
    @discord.ui.button(
        label="📋 My Sessions",
        style=discord.ButtonStyle.gray,
        custom_id="tto_my_sessions",
    )
    async def my_sessions_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        chat_id = str(interaction.user.id)
        ws_name = _get_docked_ws(chat_id)

        if not ws_name:
            await interaction.response.defer(ephemeral=True)
            workspaces = _get_workspace_list()
            if not workspaces:
                await interaction.followup.send(
                    embed=discord.Embed(title="No Workspaces", color=COLOR_ERROR),
                    ephemeral=True,
                )
                return

            async def on_picked(inter, selected):
                await _send_sessions_list(inter, selected, chat_id)

            view = _WorkspacePickerView(on_picked_callback=on_picked)
            await interaction.followup.send(
                embed=discord.Embed(
                    title="👋 Pick a workspace first!",
                    description="Then you'll see your sessions.",
                    color=COLOR_PRIMARY,
                ),
                view=view,
                ephemeral=True,
            )
            return

        await _send_sessions_list(interaction, ws_name, chat_id)

    # ── ❓ Help ─────────────────────────────────────────────────────────
    @discord.ui.button(
        label="❓ Help",
        style=discord.ButtonStyle.secondary,
        custom_id="tto_help",
    )
    async def help_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        ws_name = _get_docked_ws(str(interaction.user.id))
        embed = discord.Embed(
            title="🤖 TTO — How to Use",
            description="Everything is buttons. No typing needed.",
            color=COLOR_PRIMARY,
        )
        embed.add_field(
            name="🔧 Workspaces",
            value="Pick which workspace to work in",
            inline=True,
        )
        embed.add_field(
            name="➕ New Session",
            value="Create a new agent session",
            inline=True,
        )
        embed.add_field(
            name="📋 My Sessions",
            value="See all sessions + dispatch tasks",
            inline=True,
        )
        embed.add_field(
            name="🚀 Dispatch",
            value="Tap a session → tap Dispatch → type/speak your task",
            inline=True,
        )
        embed.add_field(
            name="🛑 Abort",
            value="Kill a running session",
            inline=True,
        )
        embed.add_field(
            name="🎙️ Voice",
            value="Send a voice message here — TTO hears and acts",
            inline=True,
        )
        if ws_name:
            embed.set_footer(text=f"Docked: {ws_name}  ·  Tap 🔧 to switch")
        else:
            embed.set_footer(text="Not docked — tap 🔧 Workspaces to start")
        await interaction.followup.send(embed=embed, ephemeral=True)


# ── Discord Bot ─────────────────────────────────────────────────────────────

def create_bot() -> commands.Bot:
    """Create and configure the bot with all 9 slash commands + persistent panel."""
    global _poller  # ← MUST be first statement before ANY _poller reference
    intents = discord.Intents.default()
    intents.message_content = True
    bot = commands.Bot(command_prefix="!", intents=intents)
    poller = _LivePoller(bot)
    _poller = poller
    bot.add_view(ControlPanelView())  # persistent custom_ids survive restarts

    # T2: Wire voice message → Whisper → agent dispatch
    try:
        from remote import voice_msg as _voice
        _voice.install_listener(bot, _bridge)
        print("[discord] ✅ T2 voice listener installed", flush=True)
    except Exception as e:
        print(f"[discord] ⚠️ T2 voice listener failed: {e}", flush=True)

    @bot.event
    async def on_message(message: discord.Message):
        # ── PLAIN-TEXT LANE: typing ANYWHERE = the voice lane (no mic, no panel, no slash, no email) ──
        if message.author == bot.user or message.author.bot:
            return
        if not message.content or not message.content.strip():
            return
        if message.content.startswith("/"):
            return  # slash nudges were removed — nothing left to route here anyway
        text = message.content.strip()
        print(f"[discord] 📝 plain-text lane: {message.channel.name} ← {text[:80]}", flush=True)
        try:
            from remote import voice_msg as _lane
            lane = getattr(_lane, "_dispatch_text", None)
            ran = False
            if lane:
                result = await lane(message, text)
                ran = True
                print(f"[discord] ✅ plain-text dispatched → {str(result)[:90]}", flush=True)
            if not ran:
                # Fall back: treat as intent sentence (workspace/new/dispatch) via service intent
                from remote import service as _svc
                await _svc.dispatch_discord_text(message, text)
                print("[discord] ✅ plain-text → service dispatcher", flush=True)
        except Exception as e:
            print(f"[discord] ⚠️ plain-text lane error: {e}", flush=True)

    @bot.event
    async def on_ready():
        print(f"[discord] ✅ Connected as {bot.user} (id={bot.user.id})", flush=True)
        log.info("Discord bot connected as %s (id=%s)", bot.user, bot.user.id)
        try:
            synced = await bot.tree.sync()
            print(f"[discord] ✅ Synced {len(synced)} slash commands", flush=True)
            log.info("Synced %d slash commands", len(synced))
        except Exception as e:
            print(f"[discord] ❌ Failed to sync commands: {e}", flush=True)
            log.error("Failed to sync commands: %s", e)
        # Auto-post the control panel to the first guild
        for guild in bot.guilds:
            for ch in guild.text_channels:
                if ch.permissions_for(guild.me).send_messages:
                    try:
                        embed = discord.Embed(
                            title="🤖 TTO — Agent Remote",
                            description="**No typing needed — everything is buttons.**\nTap a button to get started.",
                            color=discord.Color(0x5865F2),
                        )
                        embed.add_field(name="🔧 Workspaces", value="Pick workspace", inline=True)
                        embed.add_field(name="➕ New Session", value="Create session", inline=True)
                        embed.add_field(name="📋 My Sessions", value="View sessions", inline=True)
                        embed.add_field(name="❓ Help", value="How to use", inline=True)
                        await ch.send(embed=embed, view=ControlPanelView())
                        print(f"[discord] ✅ Panel posted to {guild.name}#{ch.name}", flush=True)
                        return
                    except Exception as e:
                        print(f"[discord] ❌ Panel post failed: {e}", flush=True)

    # ── /help ────────────────────────────────────────────────────────────
    @bot.tree.command(name="help", description="List all agent workspace commands")
    async def cmd_help(interaction: discord.Interaction):
        ws_fn = _b("agent_current_ws")
        cur = ws_fn() if ws_fn else None
        docked_ws = cur if isinstance(cur, str) and cur else None
        embed = discord.Embed(
            title="AGENT WORKSPACE — Commands",
            color=COLOR_PRIMARY,
        )
        cmds = [
            ("🔧 Workspaces", "Tap to see + dock into a workspace"),
            ("➕ New Session", "Tap to create a new agent session"),
            ("📋 My Sessions", "Tap to see sessions + dispatch with buttons"),
            ("🎙️ Voice Note", "Tap 📲 then record — TTO hears and acts"),
        ]
        embed.add_field(
            name="Buttons",
            value="\n".join(f"{c} — {d}" for c, d in cmds),
            inline=False,
        )
        embed.add_field(
            name="Zero typing",
            value="No slash commands. Everything is a button tap.",
            inline=False,
        )
        if docked_ws:
            embed.set_footer(text=f"Docked: {docked_ws}")
        else:
            embed.set_footer(text="Not docked — tap 🔧 Workspaces to start")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ── /workspaces ──────────────────────────────────────────────────────
    @bot.tree.command(name="workspaces", description="List agent workspaces")
    async def cmd_workspaces(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        ws_fn = _b("agent_workspaces")
        workspaces = ws_fn() if ws_fn else []
        embed = _build_workspaces_embed(workspaces)
        # Build numbered buttons
        view = discord.ui.View(timeout=300)
        for i, ws in enumerate(workspaces, 1):
            name = ws.get("name") or ws.get("id") or f"workspace-{i}"
            btn = discord.ui.Button(
                label=f"#{i} {name[:20]}",
                style=discord.ButtonStyle.primary,
                custom_id=f"ws_use_{name}",
            )
            view.add_item(btn)
            # Add click handler via callback
            async def _use_callback(bttn: discord.ui.Button, ws_name: str = name):
                set_ws_fn = _b("agent_set_current_ws")
                if set_ws_fn:
                    set_ws_fn(ws_name)
                await interaction.followup.send(
                    f"✅ Docked: **{ws_name}**",
                    ephemeral=True,
                )
            btn.callback = _use_callback
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    # ── /use ─────────────────────────────────────────────────────────────
    @bot.tree.command(name="use", description="Dock this chat into a workspace (no arg = undock)")
    @app_commands.describe(workspace="Workspace name to dock into (omit to undock)")
    async def cmd_use(interaction: discord.Interaction, workspace: Optional[str] = None):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)
        set_ws_fn = _b("agent_set_current_ws")
        if not set_ws_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return
        if not workspace or not workspace.strip():
            # Undock
            set_ws_fn("")
            # Also clear per-chat entry
            set_chat_ws_fn = _b("agent_set_chat_ws")
            if set_chat_ws_fn:
                set_chat_ws_fn(chat_id, "")
            await interaction.followup.send("✅ Undocked.", ephemeral=True)
            return
        # Dock
        set_ws_fn(workspace.strip())
        set_chat_ws_fn = _b("agent_set_chat_ws")
        if set_chat_ws_fn:
            set_chat_ws_fn(chat_id, workspace.strip())
        await interaction.followup.send(
            f"✅ Docked: **{workspace.strip()}**\n"
            f"Workspace-specific commands will now resolve against this workspace.",
            ephemeral=True,
        )

    # ── /sessions ────────────────────────────────────────────────────────
    @bot.tree.command(name="sessions", description="List sessions in the docked workspace")
    async def cmd_sessions(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)

        # Get docked workspace
        get_chat_ws_fn = _b("agent_get_chat_ws")
        ws_name = get_chat_ws_fn(chat_id) if get_chat_ws_fn else None
        if not ws_name:
            ws_fn = _b("agent_current_ws")
            ws_name = ws_fn() if ws_fn else None
        if not ws_name:
            await interaction.followup.send(
                "❌ Not docked. Tap 🔧 Workspaces to start.",
                ephemeral=True,
            )
            return

        # List sessions
        sess_fn = _b("agent_sessions")
        if not sess_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return
        result = await sess_fn()
        if not result.get("ok"):
            await interaction.followup.send(
                f"❌ Failed to list sessions: {result.get('error', 'unknown')}",
                ephemeral=True,
            )
            return

        all_sessions = result.get("sessions", [])

        # Filter to sessions in this workspace
        get_ws_fn = _b("agent_resolve_workspace")
        ws = get_ws_fn(ws_name) if get_ws_fn else None
        ws_path = (ws.get("projectPath") or "").rstrip("/") if ws else ""
        scoped = []
        for s in all_sessions:
            cwd = (s.get("cwd") or "").rstrip("/")
            if ws_path and cwd.startswith(ws_path):
                scoped.append(s)
        if not scoped:
            scoped = all_sessions  # fallback: show all if no path match

        embed = _build_sessions_embed(scoped, ws_name)

        # Build colored buttons
        view = discord.ui.View(timeout=300)
        for s in scoped:
            short = s.get("short_id")
            if short is None:
                continue
            status = (s.get("status") or "idle").lower()
            if status in ("running", "streaming"):
                style = discord.ButtonStyle.primary  # orange via embed
            elif status in ("completed", "done", "finished"):
                style = discord.ButtonStyle.success  # green
            else:
                style = discord.ButtonStyle.secondary  # grey
            label = f"#{short}"
            btn = discord.ui.Button(
                label=label,
                style=style,
                custom_id=f"sess_open_{short}",
            )

            async def _open_callback(bttn: discord.ui.Button, n: int = short, ws: str = ws_name):
                # Defer is needed since we're responding to a button click
                try:
                    resolve_fn = _b("resolve_session")
                    if not resolve_fn:
                        return
                    resolved = resolve_fn(chat_id, str(n))
                    real_id = resolved["real"]
                    session_fn = _b("agent_session")
                    if not session_fn:
                        return
                    summary = await session_fn(real_id)
                    embed2 = _build_session_embed(summary, n, ws)
                    # Send new message with session detail + buttons
                    detail_view = _build_session_buttons(n, ws, chat_id)
                    await interaction.followup.send(embed=embed2, view=detail_view, ephemeral=True)
                except Exception as e:
                    if _is_session_not_in_workspace(e):
                        await interaction.followup.send(
                            f"❌ Session #{e.n} not found in workspace '{e.ws}'.",
                            ephemeral=True,
                        )
                    else:
                        await interaction.followup.send(
                            f"❌ Error: {e}",
                            ephemeral=True,
                        )

            btn.callback = _open_callback
            view.add_item(btn)

        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    # ── /new ─────────────────────────────────────────────────────────────
    @bot.tree.command(name="new", description="Create a new session in the docked workspace")
    @app_commands.describe(name="Session name", agent="Agent (build or plan)")
    async def cmd_new(interaction: discord.Interaction, name: str, agent: str = "build"):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)

        # Get docked workspace
        get_chat_ws_fn = _b("agent_get_chat_ws")
        ws_name = get_chat_ws_fn(chat_id) if get_chat_ws_fn else None
        if not ws_name:
            ws_fn = _b("agent_current_ws")
            ws_name = ws_fn() if ws_fn else None
        if not ws_name:
            await interaction.followup.send(
                "❌ Not docked. Tap 🔧 Workspaces to start.",
                ephemeral=True,
            )
            return

        create_fn = _b("create_agent_session")
        if not create_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return
        result = await create_fn(ws_name, agent.strip().lower())
        if not result.get("ok"):
            await interaction.followup.send(
                f"❌ Create failed: {result.get('error', 'unknown')}",
                ephemeral=True,
            )
            return
        short = result.get("short_id")
        real_id = result.get("id", "")
        embed = discord.Embed(
            title=f"AGENT WORKSPACE — {ws_name}",
            description=(
                f"✅ Session created: **{name}**\n"
                f"Agent: `{agent}`\n"
                f"Short ID: `#{short}`\n"
                f"Tap 📋 My Sessions → tap this session → tap 🚀 Dispatch to send a task."
            ),
            color=COLOR_DONE,
        )
        await interaction.followup.send(embed=embed, ephemeral=True)

    # ── /session ─────────────────────────────────────────────────────────
    @bot.tree.command(name="session", description="Show session detail (status, todos, messages)")
    @app_commands.describe(n="Session number")
    async def cmd_session(interaction: discord.Interaction, n: str):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)

        # Get workspace name
        get_chat_ws_fn = _b("agent_get_chat_ws")
        ws_name = get_chat_ws_fn(chat_id) if get_chat_ws_fn else None
        if not ws_name:
            ws_fn = _b("agent_current_ws")
            ws_name = ws_fn() if ws_fn else None

        try:
            resolve_fn = _b("resolve_session")
            if not resolve_fn:
                await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
                return
            resolved = resolve_fn(chat_id, n)
        except Exception as e:
            if _is_session_not_in_workspace(e):
                await interaction.followup.send(
                    f"❌ Session #{e.n} not found in workspace '{e.ws}'.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return

        real_id = resolved["real"]
        short_id = resolved["short"]

        session_fn = _b("agent_session")
        if not session_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return
        summary = await session_fn(real_id)
        embed = _build_session_embed(summary, short_id, ws_name or "global")

        # Buttons: Send Task, Abort, Back
        view = _build_session_buttons(short_id, ws_name or "global", chat_id)
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    # ── /task ────────────────────────────────────────────────────────────
    @bot.tree.command(name="task", description="Send a task to a session")
    @app_commands.describe(n="Session number", text="Task description")
    async def cmd_task(interaction: discord.Interaction, n: str, text: str):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)

        try:
            resolve_fn = _b("resolve_session")
            if not resolve_fn:
                await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
                return
            resolved = resolve_fn(chat_id, n)
        except Exception as e:
            if _is_session_not_in_workspace(e):
                await interaction.followup.send(
                    f"❌ Session #{e.n} not found in workspace '{e.ws}'.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return

        real_id = resolved["real"]
        short_id = resolved["short"]

        send_fn = _b("send_agent_task")
        if not send_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return

        # Send task (non-blocking: use create_task to avoid long defer)
        async def _do_send():
            try:
                result = await send_fn(real_id, text)
                # Get workspace name
                get_chat_ws_fn = _b("agent_get_chat_ws")
                ws_name = get_chat_ws_fn(chat_id) if get_chat_ws_fn else None
                if not ws_name:
                    ws_fn = _b("agent_current_ws")
                    ws_name = ws_fn() if ws_fn else None

                if result.get("ok"):
                    # Fetch updated session info
                    session_fn = _b("agent_session")
                    summary = await session_fn(real_id) if session_fn else {}
                    embed = _build_session_embed(summary, short_id, ws_name or "global")
                    msg = await interaction.followup.send(
                        embed=embed,
                        ephemeral=True,
                    )
                    # Start live poller
                    poller.start(msg, chat_id, real_id, short_id, ws_name or "global")
                else:
                    await interaction.followup.send(
                        f"❌ Task failed: {result.get('error', 'unknown')}",
                        ephemeral=True,
                    )
            except Exception as e:
                try:
                    await interaction.followup.send(
                        f"❌ Task error: {e}",
                        ephemeral=True,
                    )
                except Exception:
                    pass

        asyncio.create_task(_do_send())

    # ── /abort ───────────────────────────────────────────────────────────

    # ── /panel ─────────────────────────────────────────────────────────
    @bot.tree.command(name="panel", description="Post the control panel in this channel")
    async def cmd_panel(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=False)
        panel_embed = discord.Embed(
            title="🤖 TTO — Agent Remote",
            description="Tap a button to get started. No typing needed.",
            color=discord.Color(0x5865F2),
        )
        panel_embed.add_field(name="🔧 Workspaces", value="Pick a workspace to dock into", inline=True)
        panel_embed.add_field(name="➕ New Session", value="Create a new agent session", inline=True)
        panel_embed.add_field(name="📋 My Sessions", value="See all sessions + dispatch tasks", inline=True)
        panel_embed.add_field(name="❓ Help", value="How to use buttons", inline=True)
        await interaction.followup.send(embed=panel_embed, view=ControlPanelView(), ephemeral=False)

    @bot.tree.command(name="abort", description="Abort a running session")
    @app_commands.describe(n="Session number")
    async def cmd_abort(interaction: discord.Interaction, n: str):
        await interaction.response.defer(ephemeral=True)
        chat_id = str(interaction.user.id)

        try:
            resolve_fn = _b("resolve_session")
            if not resolve_fn:
                await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
                return
            resolved = resolve_fn(chat_id, n)
        except Exception as e:
            if _is_session_not_in_workspace(e):
                await interaction.followup.send(
                    f"❌ Session #{e.n} not found in workspace '{e.ws}'.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return

        real_id = resolved["real"]
        short_id = resolved["short"]

        abort_fn = _b("agent_abort")
        if not abort_fn:
            await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
            return
        result = await abort_fn(real_id)

        # Get workspace name
        get_chat_ws_fn = _b("agent_get_chat_ws")
        ws_name = get_chat_ws_fn(chat_id) if get_chat_ws_fn else None
        if not ws_name:
            ws_fn = _b("agent_current_ws")
            ws_name = ws_fn() if ws_fn else None

        if result.get("ok"):
            embed = discord.Embed(
                title=f"AGENT WORKSPACE — {ws_name or 'global'}",
                description=f"⏹️ Session `#{short_id}` aborted.",
                color=COLOR_IDLE,
            )
        else:
            embed = discord.Embed(
                title=f"AGENT WORKSPACE — {ws_name or 'global'}",
                description=f"❌ Abort failed: {result.get('error', 'unknown')}",
                color=COLOR_ERROR,
            )
        await interaction.followup.send(embed=embed, ephemeral=True)

    # ── Send Task modal ──────────────────────────────────────────────────
    class SendTaskModal(discord.ui.Modal, title="Send Task"):
        task_text = discord.ui.TextInput(
            label="Task description",
            style=discord.TextStyle.paragraph,
            placeholder="Describe what the agent should do...",
            required=True,
            max_length=4000,
        )

        def __init__(self, short_id: int, ws_name: str, chat_id: str):
            super().__init__()
            self.short_id = short_id
            self.ws_name = ws_name
            self.chat_id = chat_id

        async def on_submit(self, interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            resolve_fn = _b("resolve_session")
            send_fn = _b("send_agent_task")
            if not resolve_fn or not send_fn:
                await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
                return

            try:
                resolved = resolve_fn(self.chat_id, str(self.short_id))
            except Exception as e:
                await interaction.followup.send(f"❌ {e}", ephemeral=True)
                return

            real_id = resolved["real"]

            async def _do_send():
                try:
                    result = await send_fn(real_id, self.task_text.value)
                    if result.get("ok"):
                        session_fn = _b("agent_session")
                        summary = await session_fn(real_id) if session_fn else {}
                        embed = _build_session_embed(summary, self.short_id, self.ws_name)
                        msg = await interaction.followup.send(embed=embed, ephemeral=True)
                        poller.start(msg, self.chat_id, real_id, self.short_id, self.ws_name)
                    else:
                        await interaction.followup.send(
                            f"❌ Task failed: {result.get('error', 'unknown')}",
                            ephemeral=True,
                        )
                except Exception as e:
                    try:
                        await interaction.followup.send(f"❌ Task error: {e}", ephemeral=True)
                    except Exception:
                        pass

            asyncio.create_task(_do_send())

    # ── Session detail button builder ────────────────────────────────────
    def _build_session_buttons(short_id: int, ws_name: str, chat_id: str) -> discord.ui.View:
        view = discord.ui.View(timeout=300)

        # Send Task button -> opens modal
        async def send_task_callback(interaction: discord.Interaction):
            modal = SendTaskModal(short_id, ws_name, chat_id)
            await interaction.response.send_modal(modal)

        btn_task = discord.ui.Button(
            label="Send Task",
            style=discord.ButtonStyle.primary,
            custom_id=f"sess_task_{short_id}",
        )
        btn_task.callback = send_task_callback
        view.add_item(btn_task)

        # Abort button
        async def abort_callback(interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            resolve_fn = _b("resolve_session")
            abort_fn = _b("agent_abort")
            if not resolve_fn or not abort_fn:
                await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
                return
            try:
                resolved = resolve_fn(chat_id, str(short_id))
            except Exception as e:
                await interaction.followup.send(f"❌ {e}", ephemeral=True)
                return
            result = await abort_fn(resolved["real"])
            if result.get("ok"):
                await interaction.followup.send(
                    f"⏹️ Session `#{short_id}` aborted.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    f"❌ Abort failed: {result.get('error', 'unknown')}",
                    ephemeral=True,
                )

        btn_abort = discord.ui.Button(
            label="Abort",
            style=discord.ButtonStyle.danger,
            custom_id=f"sess_abort_{short_id}",
        )
        btn_abort.callback = abort_callback
        view.add_item(btn_abort)

        # Back button -> returns to /sessions
        async def back_callback(interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            sess_fn = _b("agent_sessions")
            get_ws_fn = _b("agent_resolve_workspace")
            if not sess_fn:
                await interaction.followup.send("❌ Bridge not initialized.", ephemeral=True)
                return
            result = await sess_fn()
            all_sessions = result.get("sessions", []) if result.get("ok") else []
            ws = get_ws_fn(ws_name) if get_ws_fn else None
            ws_path = (ws.get("projectPath") or "").rstrip("/") if ws else ""
            scoped = [
                s for s in all_sessions
                if ws_path and (s.get("cwd") or "").rstrip("/").startswith(ws_path)
            ] or all_sessions
            embed = _build_sessions_embed(scoped, ws_name)
            btn_view = discord.ui.View(timeout=300)
            for s in scoped:
                short = s.get("short_id")
                if short is None:
                    continue
                status = (s.get("status") or "idle").lower()
                if status in ("running", "streaming"):
                    style = discord.ButtonStyle.primary
                elif status in ("completed", "done", "finished"):
                    style = discord.ButtonStyle.success
                else:
                    style = discord.ButtonStyle.secondary

                async def _open_cb(bttn: discord.ui.Button, n: int = short, ws: str = ws_name):
                    try:
                        r = _b("resolve_session")(chat_id, str(n))
                        sess = await _b("agent_session")(r["real"])
                        e = _build_session_embed(sess, n, ws)
                        v = _build_session_buttons(n, ws, chat_id)
                        await interaction.followup.send(embed=e, view=v, ephemeral=True)
                    except Exception as exc:
                        await interaction.followup.send(f"❌ {exc}", ephemeral=True)

                btn = discord.ui.Button(
                    label=f"#{short}", style=style,
                    custom_id=f"sess_back_open_{short}",
                )
                btn.callback = _open_cb
                btn_view.add_item(btn)
            await interaction.followup.send(embed=embed, view=btn_view, ephemeral=True)

        btn_back = discord.ui.Button(
            label="Back",
            style=discord.ButtonStyle.secondary,
            custom_id=f"sess_back_{short_id}",
        )
        btn_back.callback = back_callback
        view.add_item(btn_back)

        return view


    # ── Auto-post control panel when bot joins a server ──────────────────
    @bot.event
    async def on_guild_available(guild: discord.Guild):
        """Post the 4-button control panel to the first sendable channel."""
        panel_embed = discord.Embed(
            title="🤖 TTO — Agent Remote",
            description="Tap a button to get started. **No typing needed — everything is buttons.**",
            color=discord.Color(0x5865F2),
        )
        panel_embed.add_field(name="🔧 Workspaces", value="Pick a workspace to dock into", inline=True)
        panel_embed.add_field(name="➕ New Session", value="Create a new agent session", inline=True)
        panel_embed.add_field(name="📋 My Sessions", value="See all sessions + dispatch tasks", inline=True)
        panel_embed.add_field(name="❓ Help", value="How to use buttons", inline=True)
        for ch in guild.text_channels:
            if ch.permissions_for(guild.me).send_messages:
                try:
                    await ch.send(embed=panel_embed, view=ControlPanelView())
                    log.info("Control panel posted to %s#%s", guild.name, ch.name)
                    return
                except Exception as e:
                    log.warning("Failed to post panel to %s: %s", ch.name, e)


    return bot


# ── Entry point (called by main.py) ────────────────────────────────────────

async def run_bot(token: str, bridge: Dict[str, Any]) -> None:
    """Start the Discord bot.  Runs until cancelled.

    Called by main.py's _start_remote_loops() as an asyncio task.
    """
    register_bridge(bridge)
    bot = create_bot()
    # Surface discord.py's own INFO lines (e.g. "Logged in as …") — the root
    # logger has no handler by default, which was silently swallowing them.
    discord.utils.setup_logging(level=logging.INFO)
    try:
        await bot.start(token)
    except discord.LoginFailure:
        log.error("Discord bot login failed — check DISCORD_BOT_TOKEN")
    except Exception as e:
        log.error("Discord bot crashed: %s", e, exc_info=True)
