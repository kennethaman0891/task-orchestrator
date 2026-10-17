// xterm 6.0.0 defect patch — DECRQM crash.
//
// PROBLEM: InputHandler.requestMode evaluates `void 0 || (i = {})` — an
// assignment to an UNDECLARED variable. Chromium/V8 tolerates it, but the
// app's WebKit webview (WKWebView / Safari engine) throws
//   ReferenceError: Can't find variable: i
// from inside the write parser (diag.log stack: _innerWrite → parse → parse →
// requestMode) for every DECRQM mode query (`CSI $ p` / `CSI ? $ p`) a TUI
// sends. opencode emits these during a session, so every opencode terminal
// crashed repeatedly (observed since 2026-09-08). The app's full-history
// replay re-executed the sequences on every attach, turning it into a crash
// loop ("opencode won't open").
//
// FIX: re-register the two DECRQM handlers with a consuming no-op — later
// registrations take precedence in xterm's parser, so requestMode never runs.
// Capability queries simply get no response; CLIs handle that gracefully.

import type { Terminal } from '@xterm/xterm';

interface CsiId {
  prefix?: string;
  intermediates?: string;
  final: string;
}

export function patchXtermDecrqm(term: Terminal): void {
  try {
    const quiet = () => true;
    if (term.parser?.registerCsiHandler) {
      term.parser.registerCsiHandler({ intermediates: '$', final: 'p' }, quiet);
      term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, quiet);
    }
    const t = term as unknown as {
      _core?: {
        _inputHandler?: {
          _parser?: {
            registerCsiHandler?: (id: CsiId, handler: (p: unknown) => boolean) => unknown;
          };
        };
      };
    };
    const parser = t._core?._inputHandler?._parser;
    if (parser?.registerCsiHandler) {
      parser.registerCsiHandler({ intermediates: '$', final: 'p' }, quiet);
      parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, quiet);
    }
  } catch {
    /* patch unavailable — non-fatal */
  }
}
