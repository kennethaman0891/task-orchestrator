import { useEffect, useState } from 'react'
import './App.css'

const API = '/api/todos'

function App() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Fetch todos on mount
  useEffect(() => {
    const loadTodos = async () => {
      try {
        const res = await fetch(API)
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
        const data = await res.json()
        setTodos(data)
        setError(null)
      } catch (err) {
        setError('Could not load todos. Is the backend running on port 8001?')
      } finally {
        setLoading(false)
      }
    }
    loadTodos()
  }, [])

  const addTodo = async (e) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, completed: false }),
      })
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
      const created = await res.json()
      setTodos((prev) => [...prev, created])
      setTitle('')
      setError(null)
    } catch (err) {
      setError('Could not add todo. Is the backend running on port 8001?')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleTodo = async (todo) => {
    const next = { ...todo, completed: !todo.completed }
    // Optimistic update
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? next : t)))
    try {
      const res = await fetch(`${API}/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: todo.title, completed: next.completed }),
      })
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
      const updated = await res.json()
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    } catch (err) {
      // Revert on failure
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? todo : t)))
      setError('Could not update todo. Is the backend running on port 8001?')
    }
  }

  const deleteTodo = async (id) => {
    try {
      const res = await fetch(`${API}/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        throw new Error(`Request failed with status ${res.status}`)
      }
      setTodos((prev) => prev.filter((t) => t.id !== id))
      setError(null)
    } catch (err) {
      setError('Could not delete todo. Is the backend running on port 8001?')
    }
  }

  const remaining = todos.filter((t) => !t.completed).length

  return (
    <div className="app">
      <header className="app-header">
        <h1>Todo App</h1>
        <p className="subtitle">Keep track of what matters</p>
      </header>

      <main className="app-main">
        <form className="add-form" onSubmit={addTodo}>
          <input
            className="add-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            maxLength={200}
            aria-label="New todo title"
          />
          <button className="add-button" type="submit" disabled={submitting || !title.trim()}>
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </form>

        <div className="counter" aria-live="polite">
          {remaining} {remaining === 1 ? 'todo' : 'todos'} remaining
        </div>

        {loading && <p className="status">Loading todos…</p>}

        {!loading && error && <p className="status error">{error}</p>}

        {!loading && !error && todos.length === 0 && (
          <p className="status empty">No todos yet — add one!</p>
        )}

        {!loading && !error && todos.length > 0 && (
          <ul className="todo-list">
            {todos.map((todo) => (
              <li key={todo.id} className={`todo-item${todo.completed ? ' completed' : ''}`}>
                <label className="todo-check">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => toggleTodo(todo)}
                    aria-label={`Mark "${todo.title}" as ${todo.completed ? 'not done' : 'done'}`}
                  />
                  <span className="checkmark" aria-hidden="true" />
                </label>
                <span className="todo-title">{todo.title}</span>
                <button
                  className="delete-button"
                  onClick={() => deleteTodo(todo.id)}
                  aria-label={`Delete "${todo.title}"`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="app-footer">
        <span>API: {API} → http://localhost:8001</span>
      </footer>
    </div>
  )
}

export default App