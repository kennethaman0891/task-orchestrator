"""TTO Remote Control — WhatsApp remote-control subsystem (OpenWA).

Clean, independent subsystem: never touches the Rust terminal engine, never
duplicates task/terminal logic — everything goes through the bridge that
main.py registers with the existing TTO pipelines.  Fully optional: when
TTO_REMOTE_ENABLED is false (or OpenWA is offline) TTO works exactly as before.
"""

from .config import load_config  # noqa: F401
from .models import state  # noqa: F401
from . import notify  # noqa: F401  (exposes remote.notify for main.py's notify loop)
