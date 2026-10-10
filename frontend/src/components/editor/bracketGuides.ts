// ═══════════════════════════════════════════════════════════════════════════
// VS Code-Style Bracket Matching Extension for CodeMirror 6
// Provides clean, subtle bracket matching and error highlights without
// injecting overlapping multi-color vertical gradient lines.
// ═══════════════════════════════════════════════════════════════════════════

import { bracketMatching } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export interface BracketGuidesConfig {
  colorsDark?: string[];
  activeColorsDark?: string[];
  colorsLight?: string[];
  activeColorsLight?: string[];
}

const bracketMatchTheme = EditorView.baseTheme({
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(255, 215, 0, 0.18) !important',
    outline: '1px solid rgba(255, 215, 0, 0.75)',
    borderRadius: '2px',
    fontWeight: '600',
  },
  '.cm-nonmatchingBracket': {
    backgroundColor: 'rgba(239, 68, 68, 0.25) !important',
    outline: '1px solid #ef4444',
    borderRadius: '2px',
  },
});

export function bracketPairGuides(_config?: BracketGuidesConfig): Extension[] {
  return [
    bracketMatching(),
    bracketMatchTheme,
  ];
}
