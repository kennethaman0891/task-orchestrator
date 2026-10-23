// Developer City — one folder level in a pinned card. Not a Graphify run.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { listFiles, type FileEntry } from '@/lib/api';

function normalizeDir(path: string): string {
  if (!path || path === '/') return path;
  return path.replace(/\/+$/, '');
}

function childPath(dir: string, name: string): string {
  const base = normalizeDir(dir);
  if (!base) return name;
  if (base === '/') return `/${name}`;
  return `${base}/${name}`;
}

function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

const card: CSSProperties = {
  position: 'absolute',
  left: 16,
  top: 120,
  width: 300,
  maxHeight: 'calc(100% - 140px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  background: 'rgba(15,18,28,0.92)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 14,
  zIndex: 30,
  color: 'rgba(236,238,244,0.94)',
  fontSize: 13,
  lineHeight: 1.45,
  backdropFilter: 'blur(14px)',
};

const quietBtn: CSSProperties = {
  flex: 'none',
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: 'rgba(255,255,255,0.46)',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const rowBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  maxWidth: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: '5px 0',
  color: 'rgba(236,238,244,0.92)',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const fileRow: CSSProperties = {
  padding: '5px 0',
  color: 'rgba(255,255,255,0.55)',
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const muted: CSSProperties = {
  color: 'rgba(255,255,255,0.42)',
  fontSize: 13,
};

export function RoadGraphPanel({
  folderPath,
  folderName,
  onClose,
}: {
  folderPath: string;
  folderName: string;
  onClose: () => void;
}) {
  const root = normalizeDir(folderPath);
  const [stack, setStack] = useState<string[]>([root]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setStack((prev) => (prev.length === 1 && prev[0] === root ? prev : [root]));
  }, [root]);

  const current = stack[stack.length - 1] ?? root;
  const atRoot = current === root;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listFiles(current)
      .then((res) => {
        if (!alive) return;
        setEntries(Array.isArray(res.files) ? res.files : []);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setEntries([]);
        setError('Could not load this folder.');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [current]);

  const byName = (a: FileEntry, b: FileEntry) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const visible = entries.filter((entry) => entry.name !== '.' && entry.name !== '..');
  const folders = visible.filter((entry) => entry.is_dir).sort(byName);
  const files = visible.filter((entry) => !entry.is_dir).sort(byName);
  const title = atRoot ? folderName : baseName(current);
  const pathLabel = atRoot ? folderPath : current;

  const openDir = (name: string) => {
    setStack((prev) => [...prev, childPath(prev[prev.length - 1] ?? root, name)]);
  };

  return (
    <div style={card}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <button type="button" onClick={onClose} style={quietBtn}>
            Close
          </button>
        </div>
        <div
          title={pathLabel}
          style={{ ...muted, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {pathLabel}
        </div>
      </div>

      {!atRoot && (
        <button type="button" onClick={() => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))} style={{ ...quietBtn, alignSelf: 'flex-start' }}>
          Back
        </button>
      )}

      <div style={{ minHeight: 0, overflowY: 'auto', paddingLeft: 12 }}>
        {loading && <div style={muted}>Loading…</div>}
        {!loading && error && <div style={muted}>{error}</div>}
        {!loading && !error && folders.length === 0 && files.length === 0 && (
          <div style={muted}>No files here.</div>
        )}
        {!loading && !error && folders.map((entry) => (
          <button key={`d:${entry.name}`} type="button" onClick={() => openDir(entry.name)} style={rowBtn} title={entry.name}>
            {entry.name}
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>/</span>
          </button>
        ))}
        {!loading && !error && folders.length > 0 && files.length > 0 && <div style={{ height: 10 }} />}
        {!loading && !error && files.map((entry) => (
          <div key={`f:${entry.name}`} style={fileRow} title={entry.name}>
            {entry.name}
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => {
            setNote('Full Graphify runs on this folder from the workspace. This list is the folder itself.');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid rgba(197,212,255,0.4)',
            padding: '2px 0',
            color: '#d5e0ff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Open Graphify
        </button>
        {note && <div style={{ ...muted, marginTop: 10, lineHeight: 1.5 }}>{note}</div>}
      </div>
    </div>
  );
}
