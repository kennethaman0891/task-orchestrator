'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  keymap,
} from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { indentWithTab, defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import {
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  HighlightStyle,
} from '@codemirror/language';
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { getLanguage } from '@/lib/format';
import { useTheme } from '@/contexts/ThemeContext';
import { Save, FileText, Check, AlertCircle } from 'lucide-react';

// Language extensions
import { javascript as cmJavascript } from '@codemirror/lang-javascript';
import { python as cmPython } from '@codemirror/lang-python';
import { html as cmHtml } from '@codemirror/lang-html';
import { css as cmCss } from '@codemirror/lang-css';
import { json as cmJson } from '@codemirror/lang-json';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { bracketPairGuides } from './bracketGuides';

interface Props {
  path: string;
  initialContent: string;
  onSave: (content: string) => void;
  onChange?: (content: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCursorChange?: (line: number, col: number) => void;
  loading?: boolean;
  error?: string | null;
}

function getLanguageExtension(lang: string): Extension[] {
  switch (lang) {
    case 'javascript':
    case 'typescript':
      return [cmJavascript({ typescript: lang === 'typescript' })];
    case 'python':
      return [cmPython()];
    case 'html':
    case 'php':
      return [cmHtml()];
    case 'css':
      return [cmCss()];
    case 'json':
      return [cmJson()];
    default:
      return [];
  }
}

/* ── VS Code default editor palettes (Dark+ / Light+) ─────────────────
   The editor block deliberately uses VS Code's out-of-the-box colors
   instead of the app theme, so it looks like a "basic VS Code" editor.
   All non-Paper app themes get Dark+; Paper gets Light+. */
interface EditorPalette {
  bg: string; subBg: string; border: string; text: string; muted: string;
  lineNum: string; activeLine: string; selection: string; cursor: string;
  disabledBg: string;
}

const VSCODE_DARK: EditorPalette = {
  bg: '#1e1e1e', subBg: '#181818', border: '#2d2d2d', text: '#d4d4d4',
  muted: '#858585', lineNum: '#858585', activeLine: '#282828',
  selection: '#264f78', cursor: '#ffffff', disabledBg: '#2d2d2d',
};

const VSCODE_LIGHT: EditorPalette = {
  bg: '#ffffff', subBg: '#f3f3f3', border: '#e5e5e5', text: '#000000',
  muted: '#6c6c6c', lineNum: '#237893', activeLine: '#ececec',
  selection: '#add6ff', cursor: '#000000', disabledBg: '#f3f3f3',
};

const vsCodeDarkStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: '#6a9955' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.macroName, tags.processingInstruction, tags.meta], color: '#569cd6' },
  { tag: [tags.string], color: '#ce9178' },
  { tag: [tags.regexp, tags.escape], color: '#d16969' },
  { tag: [tags.number], color: '#b5cea8' },
  { tag: [tags.bool, tags.null, tags.atom, tags.constant(tags.variableName)], color: '#569cd6' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#dcdcaa' },
  { tag: [tags.variableName, tags.propertyName], color: '#9cdcfe' },
  { tag: [tags.className, tags.definition(tags.className), tags.typeName, tags.namespace, tags.annotation, tags.labelName], color: '#4ec9b0' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#d4d4d4' },
  { tag: [tags.link, tags.url], color: '#4ec9b0', textDecoration: 'underline' },
  { tag: [tags.heading, tags.strong], color: '#569cd6', fontWeight: 'bold' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strikethrough], textDecoration: 'line-through' },
  { tag: [tags.invalid], color: '#f44747' },
]);

const vsCodeLightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: '#008000' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.macroName, tags.processingInstruction, tags.meta], color: '#0000ff' },
  { tag: [tags.string], color: '#a31515' },
  { tag: [tags.regexp, tags.escape], color: '#d16969' },
  { tag: [tags.number], color: '#09865e' },
  { tag: [tags.bool, tags.null, tags.atom, tags.constant(tags.variableName)], color: '#09865e' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#795e26' },
  { tag: [tags.variableName, tags.propertyName], color: '#001080' },
  { tag: [tags.className, tags.definition(tags.className), tags.typeName, tags.namespace, tags.annotation, tags.labelName], color: '#267f99' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#000000' },
  { tag: [tags.link, tags.url], color: '#0000ff', textDecoration: 'underline' },
  { tag: [tags.invalid], color: '#cd0000' },
]);

export function CodeEditor({
  path,
  initialContent,
  onSave,
  onChange,
  onDirtyChange,
  onCursorChange,
  loading,
  error,
}: Props) {
  const { theme: t } = useTheme();
  const isLightEditor = t.name === 'Paper';
  const pal = isLightEditor ? VSCODE_LIGHT : VSCODE_DARK;
  const highlightStyle = isLightEditor ? vsCodeLightStyle : vsCodeDarkStyle;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialContentRef = useRef(initialContent);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const [isDirty, setIsDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Keep refs up to date
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onDirtyChangeRef.current = onDirtyChange;
  onCursorChangeRef.current = onCursorChange;

  const handleSave = useCallback(() => {
    if (!viewRef.current) return;
    const content = viewRef.current.state.doc.toString();
    initialContentRef.current = content;
    setIsDirty(false);
    onDirtyChangeRef.current?.(false);
    onSaveRef.current(content);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }, []);

  // When active file changes, reset dirty state
  useEffect(() => {
    initialContentRef.current = initialContent;
    setIsDirty(false);
    onDirtyChangeRef.current?.(false);
  }, [path]);

  // Handle external updates to initialContent if file is not modified
  useEffect(() => {
    initialContentRef.current = initialContent;
    if (viewRef.current) {
      const currentDoc = viewRef.current.state.doc.toString();
      if (currentDoc !== initialContent && !isDirty) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: initialContent },
        });
      }
    }
  }, [initialContent, isDirty]);

  // Setup CodeMirror editor instance (depends ONLY on path and theme)
  useEffect(() => {
    if (!containerRef.current || loading || error) return;

    const lang = getLanguage(path);
    const languageExtensions = getLanguageExtension(lang);

    const customKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSave();
          return true;
        },
      },
      indentWithTab,
    ]);

    const baseExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      indentationMarkers({
        highlightActiveBlock: true,
        hideFirstIndent: false,
        markerType: 'codeOnly',
        thickness: 1,
        activeThickness: 1.5,
        colors: {
          dark: 'rgba(255, 255, 255, 0.12)',
          activeDark: 'rgba(255, 255, 255, 0.38)',
          light: 'rgba(0, 0, 0, 0.12)',
          activeLight: 'rgba(0, 0, 0, 0.38)',
        },
      }),
      bracketPairGuides(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
    ];

    const state = EditorState.create({
      doc: initialContentRef.current,
      extensions: [
        ...baseExtensions,
        ...languageExtensions,
        syntaxHighlighting(highlightStyle),
        customKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            const dirty = newContent !== initialContentRef.current;
            setIsDirty(dirty);
            onDirtyChangeRef.current?.(dirty);
            onChangeRef.current?.(newContent);
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const lineObj = update.state.doc.lineAt(head);
            onCursorChangeRef.current?.(lineObj.number, head - lineObj.from + 1);
          }
        }),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': {
            height: '100%',
            background: pal.bg,
            color: pal.text,
            fontSize: t.fontSize.xs,
          },
          '.cm-scroller': {
            fontFamily: t.fontFamily.mono,
            lineHeight: '1.6',
            overflow: 'auto',
          },
          // Standard VS Code / Antigravity styled gutters
          '.cm-gutters': {
            background: pal.subBg,
            borderRight: `1px solid ${pal.border}`,
            color: pal.lineNum,
          },
          '.cm-lineNumbers .cm-gutterElement': {
            padding: '0 8px 0 14px',
            minWidth: '38px',
            textAlign: 'right',
            userSelect: 'none',
            fontSize: t.fontSize.xs,
          },
          '.cm-foldGutter .cm-gutterElement': {
            padding: '0 4px',
            cursor: 'pointer',
            opacity: 0.6,
            textAlign: 'center',
          },
          '.cm-foldGutter .cm-gutterElement:hover': {
            opacity: 1,
            color: pal.text,
          },
          '.cm-activeLine': {
            background: pal.activeLine,
          },
          '.cm-activeLineGutter': {
            background: pal.activeLine,
            color: pal.text,
          },
          '.cm-cursor': {
            borderLeftColor: pal.cursor,
            borderLeftWidth: '2px',
          },
          '.cm-content': {
            color: pal.text,
            caretColor: pal.cursor,
            padding: '6px 0',
          },
          '.cm-line': {
            position: 'relative',
            padding: '0 8px',
            '--indent-marker-bg-color': isLightEditor ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.22)',
            '--indent-marker-active-bg-color': isLightEditor ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.55)',
          },
          '.cm-indent-markers::before': {
            left: '8px !important',
            zIndex: '1 !important',
            pointerEvents: 'none',
          },
          '.cm-bracket-guide-line::after': {
            left: '8px !important',
            zIndex: '1 !important',
            pointerEvents: 'none',
          },
          '.cm-nonmatchingBracket': {
            background: 'transparent',
          },
          '.cm-selectionBackground, ::selection': {
            background: `${pal.selection} !important`,
          },
          '.cm-tooltip': {
            background: t.colors.bg.elevated,
            border: `1px solid ${t.colors.border.primary}`,
            color: t.colors.text.primary,
            borderRadius: '4px',
          },
          '.cm-tooltip-autocomplete': {
            '& > ul': {
              fontFamily: t.fontFamily.mono,
              fontSize: t.fontSize.xs,
            },
            '& li': {
              padding: `${t.spacing.xs} ${t.spacing.sm}`,
            },
            '& li[aria-selected]': {
              background: t.colors.accent.primary,
              color: t.colors.text.inverse,
            },
          },
          '.cm-panel': {
            background: t.colors.bg.secondary,
            border: `1px solid ${t.colors.border.subtle}`,
            color: t.colors.text.primary,
          },
          '.cm-searching': {
            background: t.colors.warning.light,
            color: t.colors.warning.primary,
          },
        }, { dark: !isLightEditor }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path, t, loading, error, handleSave]);

  // Global shortcut fallback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!loading) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, handleSave]);

  if (loading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        flex: 1, height: '100%',
        color: pal.muted, gap: '8px',
        background: pal.bg,
      }}>
        <div style={{
          width: '18px', height: '18px',
          border: `2px solid ${t.colors.border.primary}`,
          borderTopColor: t.colors.accent.primary,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: t.fontSize.xs }}>Loading file...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        flex: 1, height: '100%',
        color: t.colors.danger.primary,
        background: pal.bg,
        gap: '8px', padding: t.spacing.md,
      }}>
        <AlertCircle size={24} />
        <div style={{ fontSize: t.fontSize.sm, fontWeight: t.fontWeight.medium }}>Unable to load file</div>
        <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted }}>{error}</div>
      </div>
    );
  }

  const fileName = path.split('/').pop() || path;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      flex: 1,
      background: pal.bg,
    }}>
      {/* Editor Sub-Header / Status Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        borderBottom: `1px solid ${pal.border}`,
        background: pal.subBg,
        flexShrink: 0,
        height: '34px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <FileText size={13} style={{ color: pal.muted, flexShrink: 0 }} />
          <span style={{
            fontSize: t.fontSize.xs,
            fontWeight: t.fontWeight.medium,
            color: pal.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {fileName}
          </span>
          <span style={{
            fontSize: '11px',
            color: pal.muted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            ({path})
          </span>
          {isDirty && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              fontWeight: '600',
              color: t.colors.warning.primary,
              background: t.colors.warning.light,
              padding: '1px 6px',
              borderRadius: '10px',
            }}>
              ● Modified
            </span>
          )}
          {justSaved && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '10px',
              fontWeight: '500',
              color: t.colors.success.primary,
            }}>
              <Check size={11} /> Saved
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleSave}
            disabled={!isDirty || loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: '500',
              cursor: isDirty ? 'pointer' : 'default',
              padding: '3px 9px',
              height: '24px',
              background: isDirty ? t.colors.accent.primary : pal.disabledBg,
              color: isDirty ? t.colors.text.inverse : pal.muted,
              opacity: isDirty ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
            title="Save file (Cmd/Ctrl + S)"
          >
            <Save size={12} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* CodeMirror container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          height: 'calc(100% - 34px)',
          minHeight: 0,
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
