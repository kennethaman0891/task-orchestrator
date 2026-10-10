"""FastAPI + SQLite Todo API.

Standalone backend using Python stdlib sqlite3 (no SQLAlchemy dependency).
DB file: <backend>/todos.db  (auto-created next to this module).
"""
import sqlite3
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DB_PATH = Path(__file__).resolve().parent / "todos.db"


def get_db() -> sqlite3.Connection:
    """Open a connection with row access by column name."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the todos table if it does not exist."""
    with closing(get_db()) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT    NOT NULL,
                completed  INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL
            )
            """
        )
        conn.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


# ---------------------------------------------------------------------------
# App + CORS (allow the Vite frontend on localhost:5173)
# ---------------------------------------------------------------------------
app = FastAPI(title="Todo API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class TodoCreate(BaseModel):
    title: str
    completed: bool = False


class TodoUpdate(BaseModel):
    title: str | None = None
    completed: bool | None = None


class Todo(BaseModel):
    id: int
    title: str
    completed: bool
    created_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    """Current UTC time as an ISO-8601 timestamp string."""
    return datetime.now(timezone.utc).isoformat()


def row_to_todo(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "completed": bool(row["completed"]),
        "created_at": row["created_at"],
    }


# ---------------------------------------------------------------------------
# Endpoints  (exact contract consumed by the frontend)
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    """Health check."""
    return {"status": "ok"}


@app.get("/api/todos", response_model=list[Todo])
def list_todos() -> list[dict]:
    """All todos sorted by id ascending."""
    with closing(get_db()) as conn:
        rows = conn.execute("SELECT * FROM todos ORDER BY id").fetchall()
        return [row_to_todo(r) for r in rows]


@app.post("/api/todos", response_model=Todo, status_code=201)
def create_todo(payload: TodoCreate) -> dict:
    """Create a new todo. Body: {"title": "...", "completed": false}."""
    with closing(get_db()) as conn:
        cur = conn.execute(
            "INSERT INTO todos (title, completed, created_at) VALUES (?, ?, ?)",
            (payload.title, 1 if payload.completed else 0, now_iso()),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM todos WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return row_to_todo(row)


@app.put("/api/todos/{todo_id}", response_model=Todo)
def update_todo(todo_id: int, payload: TodoUpdate) -> dict:
    """Update title and/or completed for an existing todo. 404 if missing."""
    with closing(get_db()) as conn:
        row = conn.execute(
            "SELECT * FROM todos WHERE id = ?", (todo_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Todo not found")

        title = payload.title if payload.title is not None else row["title"]
        completed = (
            payload.completed
            if payload.completed is not None
            else bool(row["completed"])
        )
        conn.execute(
            "UPDATE todos SET title = ?, completed = ? WHERE id = ?",
            (title, 1 if completed else 0, todo_id),
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM todos WHERE id = ?", (todo_id,)
        ).fetchone()
        return row_to_todo(updated)


@app.delete("/api/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: int) -> None:
    """Delete a todo. Returns 204 No Content; 404 if id not found."""
    with closing(get_db()) as conn:
        cur = conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Todo not found")
