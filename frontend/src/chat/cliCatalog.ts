// CLI + model choices for the Chat view.
// A pair becomes one workspace pane: buildLaunchCommand() is the shell line
// typed into that pane's PTY. OpenCode's interactive binary has no model flag
// on its root help, so the chosen model is stored on the pane and the process
// starts as `opencode`.

export interface CliModelOption {
  id: string;
  label: string;
}

export interface CliDef {
  id: string;
  label: string;
  /** First token of the launch line. Must be the real binary name. */
  binary: string;
  /** CliLogo id. */
  logoId: string;
  /** null = do not append a model flag. */
  modelFlag: '--model' | null;
  list: 'static' | 'remote' | 'opencode';
  staticModels: CliModelOption[];
}

export const CLI_CATALOG: CliDef[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    logoId: 'claude',
    modelFlag: '--model',
    list: 'static',
    staticModels: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
      { id: 'fable', label: 'Fable' },
    ],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    binary: 'agy',
    logoId: 'antigravity',
    modelFlag: '--model',
    list: 'remote',
    staticModels: [],
  },
  {
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    logoId: 'codex',
    modelFlag: '--model',
    list: 'remote',
    staticModels: [],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    logoId: 'opencode',
    modelFlag: null,
    list: 'opencode',
    staticModels: [],
  },
  {
    id: 'grok',
    label: 'Grok',
    binary: 'grok',
    logoId: 'grok',
    modelFlag: '--model',
    list: 'remote',
    staticModels: [],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    binary: 'gemini',
    logoId: 'gemini',
    modelFlag: '--model',
    list: 'static',
    staticModels: [],
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    binary: 'agent',
    logoId: 'cursor',
    modelFlag: '--model',
    list: 'remote',
    staticModels: [],
  },
  {
    id: 'aider',
    label: 'Aider',
    binary: 'aider',
    logoId: 'aider',
    modelFlag: '--model',
    list: 'static',
    staticModels: [],
  },
];

/** Model ids that are safe to place unquoted on a shell line. */
const MODEL_ID = /^[A-Za-z0-9._:/@+=,\[\]-]+$/;

export function cliById(id: string): CliDef | undefined {
  return CLI_CATALOG.find((c) => c.id === id);
}

export function buildLaunchCommand(cliId: string, modelId: string): string | null {
  const cli = cliById(cliId);
  const model = (modelId || '').trim();
  if (!cli || !model || model.length > 128 || !MODEL_ID.test(model)) return null;
  if (!cli.modelFlag) return cli.binary;
  return `${cli.binary} ${cli.modelFlag} ${model}`;
}

const BARE_SHELLS = new Set(['zsh', 'zshl', '/bin/zsh', 'bash', 'sh', 'exec zsh']);

/** Clone a real launch line. A blank or login shell falls back to the catalog binary. */
export function fallbackLaunchCommand(launchCommand: string | undefined, binary: string): string {
  const raw = (launchCommand || '').trim();
  if (raw && !BARE_SHELLS.has(raw)) return raw;
  return binary;
}
