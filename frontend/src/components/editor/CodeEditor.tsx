'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { indentWithTab, defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import {
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  HighlightStyle,
  indentUnit,
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
import { Save, Check, AlertCircle, WrapText, AlignLeft, ChevronRight, Folder } from 'lucide-react';
import { FileIcon } from '@/lib/treeIcons';

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
  rootPath?: string;
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
  bg: string;
  subBg: string;
  border: string;
  text: string;
  muted: string;
  lineNum: string;
  activeLine: string;
  selection: string;
  cursor: string;
  disabledBg: string;
}

const VSCODE_DARK: EditorPalette = {
  bg: '#1e1e1e',
  subBg: '#181818',
  border: '#2d2d2d',
  text: '#d4d4d4',
  muted: '#858585',
  lineNum: '#858585',
  activeLine: '#282828',
  selection: '#264f78',
  cursor: '#ffffff',
  disabledBg: '#2d2d2d',
};

const VSCODE_LIGHT: EditorPalette = {
  bg: '#ffffff',
  subBg: '#f3f3f3',
  border: '#e5e5e5',
  text: '#000000',
  muted: '#6c6c6c',
  lineNum: '#237893',
  activeLine: '#ececec',
  selection: '#add6ff',
  cursor: '#000000',
  disabledBg: '#f3f3f3',
};

const vsCodeDarkStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: '#6a9955' },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.macroName,
      tags.processingInstruction,
      tags.meta,
    ],
    color: '#569cd6',
  },
  { tag: [tags.string], color: '#ce9178' },
  { tag: [tags.regexp, tags.escape], color: '#d16969' },
  { tag: [tags.number], color: '#b5cea8' },
  { tag: [tags.bool, tags.null, tags.atom, tags.constant(tags.variableName)], color: '#569cd6' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#dcdcaa' },
  { tag: [tags.variableName, tags.propertyName], color: '#9cdcfe' },
  {
    tag: [
      tags.className,
      tags.definition(tags.className),
      tags.typeName,
      tags.namespace,
      tags.annotation,
      tags.labelName,
    ],
    color: '#4ec9b0',
  },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#d4d4d4' },
  { tag: [tags.link, tags.url], color: '#4ec9b0', textDecoration: 'underline' },
  { tag: [tags.heading, tags.strong], color: '#569cd6', fontWeight: 'bold' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strikethrough], textDecoration: 'line-through' },
  { tag: [tags.invalid], color: '#f44747' },
]);

const vsCodeLightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: '#008000' },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.macroName,
      tags.processingInstruction,
      tags.meta,
    ],
    color: '#0000ff',
  },
  { tag: [tags.string], color: '#a31515' },
  { tag: [tags.regexp, tags.escape], color: '#d16969' },
  { tag: [tags.number], color: '#09865e' },
  { tag: [tags.bool, tags.null, tags.atom, tags.constant(tags.variableName)], color: '#09865e' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#795e26' },
  { tag: [tags.variableName, tags.propertyName], color: '#001080' },
  {
    tag: [
      tags.className,
      tags.definition(tags.className),
      tags.typeName,
      tags.namespace,
      tags.annotation,
      tags.labelName,
    ],
    color: '#267f99',
  },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#000000' },
  { tag: [tags.link, tags.url], color: '#0000ff', textDecoration: 'underline' },
  { tag: [tags.invalid], color: '#cd0000' },
]);

export function CodeEditor({
  path,
  rootPath,
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
  const [lineWrap, setLineWrap] = useState(true);
  const lineWrapCompRef = useRef(new Compartment());
  const [showGuides, setShowGuides] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('tto_editor_guides');
      return stored !== null ? stored === 'true' : false;
    }
    return false;
  });
  const indentGuidesCompRef = useRef(new Compartment());
  const indentUnitCompRef = useRef(new Compartment());

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

  const breadcrumbs: string[] = useMemo(() => {
    let rel = path;
    let root = '';
    if (rootPath && path.startsWith(rootPath)) {
      rel = path.slice(rootPath.length).replace(/^[/\\]+/, '');
      root = rootPath.split(/[/\\]/).filter(Boolean).pop() || '';
    } else {
      const parts = path.split(/[/\\]/).filter(Boolean);
      if (parts.length > 2) {
        root = parts[parts.length - 3];
        rel = parts.slice(parts.length - 2).join('/');
      } else {
        return parts;
      }
    }
    const segs: string[] = rel ? rel.split(/[/\\]/).filter(Boolean) : [];
    return root ? [root, ...segs] : segs;
  }, [path, rootPath]);

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

  // Handle dynamic line-wrap changes via compartment
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: lineWrapCompRef.current.reconfigure(lineWrap ? EditorView.lineWrapping : []),
      });
    }
  }, [lineWrap]);

  // Handle dynamic indentation guides changes via compartment
  useEffect(() => {
    if (viewRef.current) {
      const guidesExtension = showGuides
        ? [
            indentationMarkers({
              highlightActiveBlock: true,
              hideFirstIndent: true, // Clean VS Code look: hides guide at column 0
              markerType: 'codeOnly',
              thickness: 1,
              activeThickness: 1,
              colors: {
                dark: 'rgba(255, 255, 255, 0.08)',
                activeDark: 'rgba(255, 255, 255, 0.28)',
                light: 'rgba(0, 0, 0, 0.08)',
                activeLight: 'rgba(0, 0, 0, 0.28)',
              },
            }),
          ]
        : [];
      viewRef.current.dispatch({
        effects: indentGuidesCompRef.current.reconfigure(guidesExtension),
      });
    }
  }, [showGuides]);

  // Setup CodeMirror editor instance (depends ONLY on path and theme)
  useEffect(() => {
    if (!containerRef.current || loading || error) return;

    const lang = getLanguage(path);
    const languageExtensions = getLanguageExtension(lang);
    const tabSize = ['python', 'rust', 'yaml', 'yml'].includes(lang) ? 4 : 2;
    const indentSpaces = ' '.repeat(tabSize);

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
      EditorState.tabSize.of(tabSize),
      indentUnitCompRef.current.of(indentUnit.of(indentSpaces)),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      indentGuidesCompRef.current.of(
        showGuides
          ? [
              indentationMarkers({
                highlightActiveBlock: true,
                hideFirstIndent: true, // Clean VS Code look: hides guide at column 0
                markerType: 'codeOnly',
                thickness: 1,
                activeThickness: 1,
                colors: {
                  dark: 'rgba(255, 255, 255, 0.08)',
                  activeDark: 'rgba(255, 255, 255, 0.28)',
                  light: 'rgba(0, 0, 0, 0.08)',
                  activeLight: 'rgba(0, 0, 0, 0.28)',
                },
              }),
            ]
          : [],
      ),
      bracketPairGuides(),
      lineWrapCompRef.current.of(lineWrap ? EditorView.lineWrapping : []),
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
        EditorView.theme(
          {
            '&': {
              height: '100%',
              background: pal.bg,
              color: pal.text,
              fontSize: '13px',
            },
            '.cm-scroller': {
              fontFamily:
                "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', Menlo, Monaco, Consolas, monospace",
              fontVariantLigatures: 'normal',
              fontFeatureSettings: "'calt' 1, 'liga' 1",
              lineHeight: '1.6',
              overflow: 'auto',
            },
            // VS Code authentic seamless gutters
            '.cm-gutters': {
              background: pal.bg,
              borderRight: 'none',
              color: pal.lineNum,
            },
            '.cm-lineNumbers': {
              minWidth: '44px',
            },
            '.cm-lineNumbers .cm-gutterElement': {
              padding: '0 12px 0 16px',
              textAlign: 'right',
              userSelect: 'none',
              fontSize: '12px',
              color: pal.lineNum,
            },
            '.cm-activeLineGutter': {
              background: 'transparent',
              color: '#c6c6c6 !important',
              fontWeight: '600',
            },
            '.cm-foldGutter': {
              width: '16px',
            },
            '.cm-foldGutter .cm-gutterElement': {
              padding: '0 2px',
              cursor: 'pointer',
              opacity: 0,
              textAlign: 'center',
              transition: 'opacity 0.15s ease',
            },
            '.cm-gutters:hover .cm-foldGutter .cm-gutterElement': {
              opacity: 0.6,
            },
            '.cm-foldGutter .cm-gutterElement:hover': {
              opacity: 1,
              color: pal.text,
            },
            '.cm-activeLine': {
              background: 'rgba(255, 255, 255, 0.035)',
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
              padding: '0 4px',
              position: 'relative',
            },
            '.cm-indent-markers::before': {
              left: '4px !important',
              height: '1.6em !important',
              maxHeight: '100%',
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
          },
          { dark: !isLightEditor },
        ),
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          height: '100%',
          color: pal.muted,
          gap: '8px',
          background: pal.bg,
        }}
      >
        <div
          style={{
            width: '18px',
            height: '18px',
            border: `2px solid ${t.colors.border.primary}`,
            borderTopColor: t.colors.accent.primary,
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span style={{ fontSize: t.fontSize.xs }}>Loading file...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          height: '100%',
          color: t.colors.danger.primary,
          background: pal.bg,
          gap: '8px',
          padding: t.spacing.md,
        }}
      >
        <AlertCircle size={24} />
        <div style={{ fontSize: t.fontSize.sm, fontWeight: t.fontWeight.medium }}>
          Unable to load file
        </div>
        <div style={{ fontSize: t.fontSize.xs, color: t.colors.text.muted }}>{error}</div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        flex: 1,
        background: pal.bg,
      }}
    >
      {/* VS Code Breadcrumb Bar & Editor Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: `1px solid ${pal.border}`,
          background: pal.bg,
          flexShrink: 0,
          height: '26px',
          fontSize: '11px',
          userSelect: 'none',
        }}
      >
        {/* Breadcrumb Path Segments */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {breadcrumbs.map((segment, index) => {
            const isLast = index === breadcrumbs.length - 1;
            const isRoot = index === 0;
            return (
              <div
                key={`${segment}-${index}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0 }}
              >
                {index > 0 && (
                  <ChevronRight
                    size={11}
                    style={{ color: pal.muted, opacity: 0.5, flexShrink: 0 }}
                  />
                )}
                {isLast ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: pal.text,
                      fontWeight: 500,
                    }}
                  >
                    <FileIcon name={segment} size={12} />
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {segment}
                    </span>
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: pal.muted,
                    }}
                  >
                    {isRoot ? <Folder size={11} style={{ opacity: 0.7 }} /> : null}
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {segment}
                    </span>
                  </span>
                )}
              </div>
            );
          })}

          {isDirty && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#e2c08d',
                marginLeft: '4px',
                flexShrink: 0,
              }}
              title="Unsaved changes"
            />
          )}
        </div>

        {/* Editor Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Toggle Indent Guides */}
          <button
            type="button"
            onClick={() => {
              setShowGuides((prev) => {
                const next = !prev;
                if (typeof window !== 'undefined') {
                  localStorage.setItem('tto_editor_guides', String(next));
                }
                return next;
              });
            }}
            title={
              showGuides
                ? 'Indentation Guides: ON (Click to toggle)'
                : 'Indentation Guides: OFF (Click to toggle)'
            }
            style={{
              background: showGuides ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
              border: showGuides ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
              borderRadius: '3px',
              color: showGuides ? pal.text : pal.muted,
              padding: '2px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'all 0.15s ease',
            }}
          >
            <AlignLeft size={12} />
            <span style={{ fontSize: '10px', opacity: 0.85 }}>Guides</span>
          </button>

          {/* Toggle Word Wrap */}
          <button
            type="button"
            onClick={() => setLineWrap((v) => !v)}
            title={
              lineWrap ? 'Word Wrap: ON (Click to toggle)' : 'Word Wrap: OFF (Click to toggle)'
            }
            style={{
              background: lineWrap ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
              border: lineWrap ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
              borderRadius: '3px',
              color: lineWrap ? pal.text : pal.muted,
              padding: '2px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'all 0.15s ease',
            }}
          >
            <WrapText size={12} />
            <span style={{ fontSize: '10px', opacity: 0.85 }}>Wrap</span>
          </button>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || loading}
            title={isDirty ? 'Save file (⌘S)' : 'All changes saved'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              border: 'none',
              borderRadius: '3px',
              fontSize: '11px',
              fontWeight: 500,
              cursor: isDirty ? 'pointer' : 'default',
              padding: '2px 8px',
              height: '20px',
              background: isDirty ? t.colors.accent.primary : 'transparent',
              color: isDirty ? t.colors.text.inverse : pal.muted,
              opacity: isDirty ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            {justSaved ? (
              <>
                <Check size={11} style={{ color: t.colors.success.primary }} />
                <span style={{ color: t.colors.success.primary }}>Saved</span>
              </>
            ) : (
              <>
                <Save size={11} />
                <span>{isDirty ? 'Save' : 'Saved'}</span>
                {isDirty && (
                  <span
                    style={{
                      fontSize: '9px',
                      opacity: 0.8,
                      background: 'rgba(255, 255, 255, 0.2)',
                      padding: '0 3px',
                      borderRadius: '2px',
                    }}
                  >
                    ⌘S
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* CodeMirror container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          height: 'calc(100% - 26px)',
          minHeight: 0,
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
