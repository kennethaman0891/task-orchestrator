// Brand logos for the CLI running in each grid pane header. Rendered in place
// of the old macOS traffic-light dots so the running tool is recognizable at a
// glance. SVGs are inlined (via ?raw) so `fill: currentColor` picks up the
// brand color set on the wrapper span.
import codexRaw from '../assets/cli-logos/codex.svg?raw';
import opencodeRaw from '../assets/cli-logos/opencode.svg?raw';
import anthropicRaw from '../assets/cli-logos/anthropic.svg?raw';
import geminiRaw from '../assets/cli-logos/googlegemini.svg?raw';
import antigravityRaw from '../assets/cli-logos/antigravity.svg?raw';
import cursorRaw from '../assets/cli-logos/cursor.svg?raw';
import vimRaw from '../assets/cli-logos/vim.svg?raw';
import nvimRaw from '../assets/cli-logos/neovim.svg?raw';
import htopRaw from '../assets/cli-logos/htop.svg?raw';
import tmuxRaw from '../assets/cli-logos/tmux.svg?raw';
import pythonRaw from '../assets/cli-logos/python.svg?raw';
import nodeRaw from '../assets/cli-logos/nodedotjs.svg?raw';
import npmRaw from '../assets/cli-logos/npm.svg?raw';
import gitRaw from '../assets/cli-logos/git.svg?raw';
import dockerRaw from '../assets/cli-logos/docker.svg?raw';
import zshRaw from '../assets/cli-logos/zsh.svg?raw';
import bashRaw from '../assets/cli-logos/gnubash.svg?raw';
import phpRaw from '../assets/cli-logos/php.svg?raw';
import primeRaw from '../assets/cli-logos/prime.svg?raw';
// Claude's official brand mark is a raster logo (user's ./claude.png) — used
// in the pane header instead of the Anthropic Simple Icons mark.
import claudePng from '../assets/cli-logos/claude.png';

const aiderRaw = '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
const kiloRaw = '<svg viewBox="0 0 24 24"><path d="M12 2l9 5.2v10.4L12 22.8 3 17.6V7.2L12 2zm-1.5 5.5v9h2.2v-3.4l3.1 3.4h2.7l-3.8-4.2 3.5-4.8h-2.6l-2.9 4v-4h-2.2z"/></svg>';

interface LogoDef {
  /** Brand color applied to the monochrome mark. */
  color: string;
  /** Raw SVG source (stripped of the outer <svg> tag at render time). */
  raw: string;
  /** Optional raster mark (PNG) rendered when present — e.g. Claude. */
  raster?: string;
}

/** Strip the outer <svg> wrapper and <title> so the inner paths can be inlined
 *  and colored via CSS `fill: currentColor`. Returns { viewBox, inner }. */
function parseSvg(raw: string): { viewBox: string; inner: string } {
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] || '0 0 24 24';
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .trim();
  return { viewBox, inner };
}

const LOGOS: Record<string, LogoDef> = {
  aider: { color: '#8B5CF6', raw: aiderRaw },
  kilo: { color: '#F59E0B', raw: kiloRaw },
  'kilo-code': { color: '#F59E0B', raw: kiloRaw },
  prime: { color: '#ffffff', raw: primeRaw },
  'prime-agent': { color: '#ffffff', raw: primeRaw },
  primeagent: { color: '#ffffff', raw: primeRaw },
  'prime-intellect': { color: '#ffffff', raw: primeRaw },
  antigravity: { color: '#ffffff', raw: antigravityRaw },
  agy: { color: '#ffffff', raw: antigravityRaw },
  jetski: { color: '#ffffff', raw: antigravityRaw },
  cursor: { color: '#ffffff', raw: cursorRaw },
  'cursor-agent': { color: '#ffffff', raw: cursorRaw },
  opencode: { color: '#ffffff', raw: opencodeRaw },
  codex: { color: '#ffffff', raw: codexRaw },
  'codex-cli': { color: '#ffffff', raw: codexRaw },
  'openai-codex': { color: '#ffffff', raw: codexRaw },
  claude: { color: '#D97757', raw: anthropicRaw, raster: claudePng },
  'claude-code': { color: '#D97757', raw: anthropicRaw, raster: claudePng },
  anthropic: { color: '#D97757', raw: anthropicRaw, raster: claudePng },
  gemini: { color: '#1C69D4', raw: geminiRaw },
  'gemini-cli': { color: '#1C69D4', raw: geminiRaw },
  googlegemini: { color: '#1C69D4', raw: geminiRaw },
  vim: { color: '#019733', raw: vimRaw },
  nvim: { color: '#57A143', raw: nvimRaw },
  neovim: { color: '#57A143', raw: nvimRaw },
  htop: { color: '#E95420', raw: htopRaw },
  tmux: { color: '#1BB91F', raw: tmuxRaw },
  python: { color: '#3776AB', raw: pythonRaw },
  python3: { color: '#3776AB', raw: pythonRaw },
  node: { color: '#339933', raw: nodeRaw },
  nodedotjs: { color: '#339933', raw: nodeRaw },
  npm: { color: '#CB3837', raw: npmRaw },
  npx: { color: '#CB3837', raw: npmRaw },
  git: { color: '#F05032', raw: gitRaw },
  docker: { color: '#2496ED', raw: dockerRaw },
  zsh: { color: '#F15A24', raw: zshRaw },
  bash: { color: '#4EAA25', raw: bashRaw },
  sh: { color: '#4EAA25', raw: bashRaw },
  shell: { color: '#4EAA25', raw: zshRaw },
  terminal: { color: '#8b98a5', raw: zshRaw },
  php: { color: '#777BB4', raw: phpRaw },
  artisan: { color: '#777BB4', raw: phpRaw },
};

/** Badge colors for recognizable-but-logo-less CLIs (letter fallback). */
const BADGE_COLORS: Record<string, string> = {
  aider: '#8B5CF6',
  codex: '#ffffff',
  top: '#E95420',
  btop: '#E95420',
  cargo: '#DEA584',
  rust: '#DEA584',
  go: '#00ADD8',
  gcc: '#A8B9CC',
  clang: '#A8B9CC',
  ssh: '#7C3AED',
  curl: '#073551',
  grep: '#94A3B8',
  rg: '#94A3B8',
  kubectl: '#326CE5',
  kubernetes: '#326CE5',
  vscode: '#007ACC',
  cursor: '#ffffff',
  freebuff: '#10B981',
  'atomic-agent': '#6366F1',
  codeium: '#3B82F6',
  continue: '#8B5CF6',
  amp: '#F59E0B',
  zed: '#F15A24',
  starship: '#000000',
  sqlite: '#003B57',
  mysql: '#4479A1',
  postgresql: '#336791',
  redis: '#DC382D',
  mongodb: '#47A248',
  just: '#142134',
  make: '#FF6F00',
  watch: '#06B6D4',
  tail: '#64748B',
  head: '#64748B',
  bottom: '#E95420',
};

// Cache parsed SVGs per raw string.
const parsedCache = new Map<string, { viewBox: string; inner: string }>();
function getParsed(raw: string) {
  let p = parsedCache.get(raw);
  if (!p) {
    p = parseSvg(raw);
    parsedCache.set(raw, p);
  }
  return p;
}

export interface CliLogoProps {
  /** cli id from the backend process scan / Rust detection (e.g. "vim"). */
  cli?: string;
  /** Icon size in px (default 13). */
  size?: number;
}

/**
 * Renders the brand logo for the given CLI. Falls back to a compact colored
 * letter badge for tools without a bundled mark, and a `>_` glyph when the
 * CLI is unknown/empty.
 */
export function CliLogo({ cli, size = 13 }: CliLogoProps) {
  const id = (cli || '').toLowerCase().trim();
  const def = LOGOS[id];

  if (!def) {
    const label = id ? id.slice(0, 2) : '>_';
    const color = BADGE_COLORS[id] || 'var(--fg-dim, #8b98a5)';
    return (
      <span
        className="ws-cli-logo ws-cli-badge"
        style={{ color }}
        title={id || 'shell'}
        aria-hidden="true"
      >
        {label}
      </span>
    );
  }

  // Raster brand mark (PNG) takes priority over the inline SVG.
  if (def.raster) {
    return (
      <span
        className="ws-cli-logo ws-cli-raster"
        style={{ color: def.color }}
        title={id}
        aria-hidden="true"
      >
        <img src={def.raster} alt="" width={size} height={size} draggable={false} />
      </span>
    );
  }

  const { viewBox, inner } = getParsed(def.raw);
  return (
    <span
      className="ws-cli-logo"
      style={{ color: def.color }}
      title={id}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="currentColor"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </span>
  );
}
