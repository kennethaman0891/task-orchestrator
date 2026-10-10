// ═══════════════════════════════════════════════════════════════════════════
// VS Code-Style Authentic File & Folder Icons
// Pixel-perfect SVG icons for explorer trees, sidebar, and editor tabs.
// ═══════════════════════════════════════════════════════════════════════════


interface FileIconProps {
  name?: string;
  size?: number;
  className?: string;
}

interface FolderIconProps {
  name?: string;
  open?: boolean;
  size?: number;
  className?: string;
}

export function FileIcon({ name = '', size = 14, className }: FileIconProps) {
  const lowerName = name.toLowerCase().trim();
  const ext = lowerName.includes('.') ? lowerName.split('.').pop() || '' : '';

  // 1. Exact Filename Matches
  if (lowerName === '.gitignore' || lowerName === '.gitattributes' || lowerName === '.gitmodules') {
    return <GitIcon size={size} className={className} />;
  }
  if (lowerName === 'package.json' || lowerName === 'package-lock.json' || lowerName === 'pnpm-lock.yaml') {
    return <NpmIcon size={size} className={className} />;
  }
  if (lowerName === 'cargo.toml' || lowerName === 'cargo.lock') {
    return <RustIcon size={size} className={className} />;
  }
  if (lowerName.startsWith('.env')) {
    return <EnvIcon size={size} className={className} />;
  }
  if (lowerName === 'dockerfile' || lowerName.endsWith('.dockerfile')) {
    return <DockerIcon size={size} className={className} />;
  }
  if (lowerName === '.ds_store') {
    return <GearIcon size={size} color="#858585" className={className} />;
  }
  if (lowerName === 'artisan') {
    return <PhpIcon size={size} className={className} />;
  }

  // 2. Extension Matches
  switch (ext) {
    case 'php':
    case 'phtml':
    case 'php3':
    case 'php4':
    case 'php5':
    case 'php7':
    case 'php8':
    case 'phps':
    case 'phar':
    case 'ctp':
      return <PhpIcon size={size} className={className} />;

    case 'py':
    case 'pyw':
    case 'ipynb':
    case 'wsgi':
      return <PythonIcon size={size} className={className} />;

    case 'html':
    case 'htm':
    case 'xhtml':
      return <HtmlIcon size={size} className={className} />;

    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <CssIcon size={size} className={className} />;

    case 'js':
    case 'mjs':
    case 'cjs':
      return <JsIcon size={size} className={className} />;

    case 'ts':
    case 'mts':
    case 'cts':
      return <TsIcon size={size} className={className} />;

    case 'jsx':
    case 'tsx':
      return <ReactIcon size={size} className={className} />;

    case 'json':
    case 'jsonc':
    case 'jsonl':
      return <JsonIcon size={size} className={className} />;

    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
    case 'bmp':
    case 'avif':
      return <ImageIcon size={size} className={className} />;

    case 'md':
    case 'markdown':
    case 'mdx':
      return <MarkdownIcon size={size} className={className} />;

    case 'rs':
      return <RustIcon size={size} className={className} />;

    case 'sh':
    case 'zsh':
    case 'bash':
    case 'fish':
    case 'command':
      return <ShellIcon size={size} className={className} />;

    case 'yml':
    case 'yaml':
      return <YamlIcon size={size} className={className} />;

    case 'toml':
    case 'ini':
    case 'cfg':
    case 'conf':
      return <GearIcon size={size} color="#cca700" className={className} />;

    case 'sql':
    case 'db':
    case 'sqlite':
    case 'sqlite3':
    case 'prisma':
      return <DatabaseIcon size={size} className={className} />;

    case 'pdf':
      return <PdfIcon size={size} className={className} />;

    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return <ArchiveIcon size={size} className={className} />;

    case 'txt':
    case 'log':
      return <TextFileIcon size={size} className={className} />;

    default:
      return <DefaultDocumentIcon size={size} className={className} />;
  }
}

export function FolderIcon({ name = '', open = false, size = 14, className }: FolderIconProps) {
  const lowerName = name.toLowerCase().replace(/^\./, '');

  let color = open ? '#e5c07b' : '#dcb67a';
  if (lowerName === 'git') color = '#f05032';
  else if (lowerName === 'claude' || lowerName === 'vscode' || lowerName === 'idea') color = '#4d9375';
  else if (lowerName === 'src' || lowerName === 'source') color = '#42a5f5';
  else if (lowerName === 'data' || lowerName === 'db' || lowerName === 'database') color = '#26a69a';
  else if (lowerName === 'node_modules') color = '#cb3837';
  else if (lowerName === 'public' || lowerName === 'static' || lowerName === 'assets') color = '#66bb6a';
  else if (lowerName === 'test' || lowerName === 'tests' || lowerName === '__tests__') color = '#ab47bc';
  else if (lowerName === 'php') color = '#777bb4';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0 }}
      className={className}
    >
      {open ? (
        // Open Folder
        <g fill={color}>
          <path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h5.5l2 2H20A1.5 1.5 0 0 1 21.5 7v1H5a1.5 1.5 0 0 0-1.4 1l-2.1 6.5V5z" opacity={0.8} />
          <path d="M22.5 10.5a1.5 1.5 0 0 0-1.4-1H5.4a1.5 1.5 0 0 0-1.4 1l-2.5 8a1.5 1.5 0 0 0 1.4 2h15.7a1.5 1.5 0 0 0 1.4-1l2.5-8z" />
        </g>
      ) : (
        // Closed Folder
        <path
          d="M2.5 5A1.5 1.5 0 0 1 4 3.5h5.5l2 2H20A1.5 1.5 0 0 1 21.5 7v12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V5z"
          fill={color}
        />
      )}
    </svg>
  );
}

// ─── Individual Specialized File Icons (Authentic Logos) ───────────────────

/** PHP: Authentic elePHPant (Elephant) Logo */
function PhpIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 516 516"
      fill="none"
      style={{ flexShrink: 0 }}
      className={className}
    >
      <path
        d="M170.322 349.808c-2.4-15.66-9-28.38-25.020-34.531-6.27-2.4-11.7-6.78-17.88-9.54-7.020-3.15-14.16-6.15-21.57-8.1-5.61-1.5-10.83 1.020-14.16 5.94-3.15 4.62-0.87 8.97 1.77 12.84 2.97 4.35 6.27 8.49 9.6 12.57 5.52 6.78 11.37 13.29 16.74 20.161 5.13 6.57 9.51 13.86 8.76 22.56-1.65 19.080-10.29 34.891-24.21 47.76-1.53 1.38-4.23 2.37-6.21 2.19-8.88-0.96-16.95-4.32-23.46-10.53-7.47-7.11-6.33-15.48 2.61-20.67 2.13-1.23 4.35-2.37 6.3-3.87 5.46-4.11 7.29-11.13 4.32-17.22-1.41-2.94-3-6.12-5.34-8.25-11.43-10.41-22.651-21.151-34.891-30.63-29.671-23.041-44.91-53.52-47.251-90.421-2.64-40.981 6.87-79.231 28.5-114.242 8.19-13.29 17.73-25.951 32.37-32.52 9.96-4.47 20.88-6.99 31.531-9.78 29.311-7.71 58.89-13.5 89.401-8.34 26.28 4.41 45.511 17.94 54.331 43.77 5.79 16.89 7.17 34.35 5.37 52.231-3.54 35.131-29.49 66.541-63.331 75.841-14.67 4.020-22.68 1.77-31.5-10.44-6.33-8.79-11.58-18.36-17.25-27.631-0.84-1.38-1.44-2.97-2.16-4.44-0.69-1.47-1.44-2.88-2.16-4.35 2.13 15.24 5.67 29.911 13.98 42.99 4.5 7.11 10.5 12.36 19.29 13.14 32.34 2.91 59.641-7.71 79.021-33.721 21.69-29.101 26.461-62.581 20.19-97.831-1.23-6.96-3.3-13.77-4.77-20.7-0.99-4.47 0.78-7.77 5.19-9.33 2.040-0.69 4.14-1.26 6.18-1.68 26.461-5.7 53.221-7.59 80.191-4.86 30.601 3.060 59.551 11.46 85.441 28.471 40.531 26.67 65.641 64.621 79.291 110.522 1.98 6.66 2.28 13.95 2.46 20.971 0.12 4.68-2.88 5.91-6.45 2.97-3.93-3.21-7.53-6.87-10.92-10.65-3.15-3.57-5.67-7.65-8.73-11.4-2.37-2.94-4.44-2.49-5.58 1.17-0.72 2.22-1.35 4.41-1.98 6.63-7.080 25.26-18.24 48.3-36.33 67.711-2.52 2.73-4.77 6.78-5.070 10.38-0.78 9.96-1.35 20.13-0.39 30.060 1.98 21.331 5.070 42.57 7.47 63.871 1.35 12.030-2.52 19.11-13.83 23.281-7.95 2.91-16.47 5.040-24.87 5.64-13.38 0.93-26.88 0.27-40.32 0.27-0.36-15 0.93-29.731-13.17-37.771 2.73-11.13 5.88-21.69 7.77-32.49 1.56-8.97 0.24-17.79-6.060-25.14-5.91-6.93-13.32-8.82-20.101-4.86-20.43 11.91-41.671 11.97-63.301 4.17-9.93-3.6-16.86-1.56-22.351 7.5-5.91 9.75-8.4 20.7-7.74 31.771 0.84 13.95 3.27 27.75 5.13 41.64 1.020 7.77 0.15 9.78-7.56 11.76-17.13 4.35-34.56 4.83-52.081 3.42-0.93-0.090-1.86-0.48-2.46-0.63-0.87-14.55 0.66-29.671-16.68-37.411 7.68-16.29 6.63-33.18 3.99-50.070l-0.060-0.15zM66.761 292.718c2.55-2.4 4.59-6.15 5.31-9.6 1.8-8.64-4.68-20.22-12.18-23.43-3.99-1.74-7.47-1.11-10.29 2.070-6.87 7.77-13.65 15.63-20.401 23.521-1.14 1.35-2.16 2.94-2.97 4.53-2.7 5.19-1.11 8.97 4.65 10.38 3.48 0.87 7.080 1.050 10.65 1.56 9.3-0.9 18.3-2.46 25.23-9v-0.030zM67.541 206.347c-0.030-6.18-5.19-11.34-11.28-11.37-6.27-0.030-11.67 5.58-11.46 11.76 0.27 6.21 5.43 11.19 11.61 11.070 6.24-0.090 11.22-5.19 11.16-11.43l-0.030-0.030z"
        fill="#777BB4"
      />
      <circle cx="56.2" cy="206.3" r="11" fill="#FFFFFF" />
      <circle cx="53" cy="206.3" r="5" fill="#181818" />
    </svg>
  );
}

/** Python: Authentic dual-tone Snake Logo */
function PythonIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path
        d="M11.9 2C6.8 2 7.1 4.2 7.1 4.2l.01 2.2h4.9v.7H5.2S2 6.7 2 11.8s2.8 4.9 2.8 4.9h1.7v-2.4s-.1-2.8 2.8-2.8h4.7s2.7.05 2.7-2.6V4.6S17 2 11.9 2zm-2.8 1.6a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"
        fill="#3776AB"
      />
      <path
        d="M12.1 22c5.1 0 4.8-2.2 4.8-2.2l-.01-2.2H12v-.7h6.8s3.2.4 3.2-4.7-2.8-4.9-2.8-4.9h-1.7v2.4s.1 2.8-2.8 2.8h-4.7s-2.7-.05-2.7 2.6v4.3s-.3 2.6 4.8 2.6zm2.8-1.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"
        fill="#FFD43B"
      />
    </svg>
  );
}

/** HTML5: Official Orange Badge */
function HtmlIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path d="M3 2l1.8 17.5L12 22l7.2-2.5L21 2H3z" fill="#E34F26" />
      <path d="M12 3.8v16.3l5.6-1.9L19 3.8H12z" fill="#EF652A" />
      <path d="M7 7.5h10l-.3 3.2H12V14h4.7l-.4 4.5-4.3 1.2v-2.3l2.2-.6.2-2.3H7.8L7 7.5z" fill="#FFFFFF" opacity={0.95} />
    </svg>
  );
}

/** CSS3: Official Blue Shield */
function CssIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path d="M3 2l1.8 17.5L12 22l7.2-2.5L21 2H3z" fill="#1572B6" />
      <path d="M12 3.8v16.3l5.6-1.9L19 3.8H12z" fill="#33A9DC" />
      <path d="M16.8 7.5H7.2l.3 3.2h8.7l-.4 4.5-3.8 1.1-3.8-1.1-.2-2.3h-2l.4 4.3 5.6 1.6 5.6-1.6.8-9.7z" fill="#FFFFFF" opacity={0.95} />
    </svg>
  );
}

/** JavaScript: Official Yellow Badge with JS */
function JsIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect width="22" height="22" x="1" y="1" rx="3" fill="#F7DF1E" />
      <path
        d="M8.2 16.5c.3.5.7.9 1.4.9.7 0 1.2-.3 1.2-1.1v-5.2h1.6v5.2c0 1.6-1 2.4-2.7 2.4-1.4 0-2.3-.7-2.7-1.6l1.2-.6zm6.3-.1c.4.7 1.1 1.1 2 1.1.9 0 1.4-.4 1.4-1 0-.7-.6-.9-1.6-1.3l-.5-.2c-1.5-.6-2.5-1.4-2.5-2.9 0-1.5 1.2-2.7 3-2.7 1.3 0 2.2.5 2.8 1.5l-1.2.8c-.3-.5-.7-.8-1.5-.8-.7 0-1.2.4-1.2 1 0 .6.5.9 1.4 1.2l.5.2c1.7.7 2.7 1.5 2.7 3.1 0 1.7-1.3 2.8-3.3 2.8-1.8 0-2.9-.9-3.4-2l1.4-.8z"
        fill="#000000"
      />
    </svg>
  );
}

/** TypeScript: Official Blue Badge with TS */
function TsIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect width="22" height="22" x="1" y="1" rx="3" fill="#3178C6" />
      <path
        d="M6 9.5h5.5v1.4H9.5V18H7.9v-7.1H6V9.5zm7.3 6.9c.4.7 1.1 1.1 2 1.1.9 0 1.4-.4 1.4-1 0-.7-.6-.9-1.6-1.3l-.5-.2c-1.5-.6-2.5-1.4-2.5-2.9 0-1.5 1.2-2.7 3-2.7 1.3 0 2.2.5 2.8 1.5l-1.2.8c-.3-.5-.7-.8-1.5-.8-.7 0-1.2.4-1.2 1 0 .6.5.9 1.4 1.2l.5.2c1.7.7 2.7 1.5 2.7 3.1 0 1.7-1.3 2.8-3.3 2.8-1.8 0-2.9-.9-3.4-2l1.4-.8z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** React: Official Cyan Atom */
function ReactIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <ellipse cx="12" cy="12" rx="3" ry="8" stroke="#61DAFB" strokeWidth="1.6" transform="rotate(30 12 12)" />
      <ellipse cx="12" cy="12" rx="3" ry="8" stroke="#61DAFB" strokeWidth="1.6" transform="rotate(90 12 12)" />
      <ellipse cx="12" cy="12" rx="3" ry="8" stroke="#61DAFB" strokeWidth="1.6" transform="rotate(150 12 12)" />
      <circle cx="12" cy="12" r="1.8" fill="#61DAFB" />
    </svg>
  );
}

/** JSON: Yellow Curly Braces */
function JsonIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path
        d="M8 4c-1.5 0-2.5 1-2.5 2.5V10c0 1-.8 1.5-1.5 1.5v1c.7 0 1.5.5 1.5 1.5v3.5C5.5 19 6.5 20 8 20h1v-1.5H8c-.8 0-1-.5-1-1v-3.5c0-1.2-.9-1.8-1.8-2 .9-.2 1.8-.8 1.8-2V7c0-.5.2-1 1-1h1V4H8zm8 0c1.5 0 2.5 1 2.5 2.5V10c0 1 .8 1.5 1.5 1.5v1c-.7 0-1.5.5-1.5 1.5v3.5c0 1.5-1 2.5-2.5 2.5h-1v-1.5h1c.8 0 1-.5 1-1v-3.5c0-1.2.9-1.8 1.8-2-.9-.2-1.8-.8-1.8-2V7c0-.5-.2-1-1-1h-1V4h1z"
        fill="#CBCB41"
      />
    </svg>
  );
}

/** Image File: Mountain & Sun */
function ImageIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#8e44ad" opacity={0.15} stroke="#a55eea" strokeWidth="1.5" />
      <circle cx="8.5" cy="8.5" r="1.8" fill="#a55eea" />
      <path d="M21 16l-5.5-5.5-8 8H19a2 2 0 0 0 2-2v-.5z" fill="#20bf6b" opacity={0.8} />
      <path d="M3 17l4.5-4.5 4 4-2.5 2.5H5a2 2 0 0 1-2-2z" fill="#26de81" />
    </svg>
  );
}

/** Markdown: Official M↓ Badge */
function MarkdownIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" fill="#083344" stroke="#0284c7" strokeWidth="1.5" />
      <path d="M5 15V9h2l2 2.5L13 9h2v6h-2v-3.5l-2 2.5-2-2.5V15H5zm12-4h2.5V9H17v2zm1.2 5l-2.2-2.5h4.4L18.2 15z" fill="#38bdf8" />
    </svg>
  );
}

/** Git: Official Orange Fork */
function GitIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path
        d="M21.6 10.9L13.1 2.4a1.8 1.8 0 0 0-2.5 0L8.2 4.8l3.1 3.1a2.1 2.1 0 0 1 2.7 2.7l3 3a2.1 2.1 0 1 1-1.3 1.2l-2.8-2.8v4.4a2.1 2.1 0 1 1-1.8 0v-4.5a2.1 2.1 0 0 1-1.1-2.8L7 6.1 2.4 10.7a1.8 1.8 0 0 0 0 2.5l8.5 8.5c.7.7 1.8.7 2.5 0l8.2-8.3a1.8 1.8 0 0 0 0-2.5z"
        fill="#F05032"
      />
    </svg>
  );
}

/** Shell: Terminal `>_` */
function ShellIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#181818" stroke="#404040" strokeWidth="1.5" />
      <path d="M6 8l4 4-4 4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 16h6" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Rust: Official Gear/Crab */
function RustIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <circle cx="12" cy="12" r="8" stroke="#DEA584" strokeWidth="2" strokeDasharray="3 2" />
      <circle cx="12" cy="12" r="4.5" fill="#DEA584" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3" stroke="#DEA584" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** YAML: Red `Y` */
function YamlIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#cb171e" opacity={0.15} stroke="#cb171e" strokeWidth="1.5" />
      <path d="M7 7l5 6v5h2v-5l5-6h-2.2L13 11.5 9.2 7H7z" fill="#cb171e" />
    </svg>
  );
}

/** NPM: Red Package */
function NpmIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" fill="#CB3837" />
      <path d="M6 7v10h6V10h3v7h3V7H6z" fill="#FFFFFF" />
    </svg>
  );
}

/** Docker: Whale / Container */
function DockerIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path
        d="M22 12.5c-.5-.4-1.6-.4-2.2-.1-.4-.8-1.2-1.3-2.1-1.3-.2 0-.4 0-.6.1-.5-1.4-1.8-2.2-3.3-2.2h-.5c-.3-1.6-1.7-2.7-3.3-2.7H2v8.5c0 3.6 2.9 6.5 6.5 6.5 4.3 0 7.8-2.6 9-6.3.8-.1 1.7-.6 2.2-1.4.7.1 1.6-.2 2.3-1.1z"
        fill="#2496ED"
      />
      <rect x="5" y="8" width="2" height="2" fill="#FFFFFF" opacity={0.9} />
      <rect x="8" y="8" width="2" height="2" fill="#FFFFFF" opacity={0.9} />
      <rect x="8" y="5.5" width="2" height="2" fill="#FFFFFF" opacity={0.9} />
    </svg>
  );
}

/** Database: Cylinder */
function DatabaseIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <ellipse cx="12" cy="6" rx="8" ry="3" fill="#009688" opacity={0.3} stroke="#009688" strokeWidth="1.5" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="#009688" strokeWidth="1.5" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" stroke="#009688" strokeWidth="1.5" />
    </svg>
  );
}

/** Environment: Key / Shield */
function EnvIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#ecd53f" opacity={0.15} stroke="#ecd53f" strokeWidth="1.5" />
      <circle cx="9.5" cy="11.5" r="3.5" stroke="#ecd53f" strokeWidth="1.8" />
      <path d="M12.5 13.5L19 20m-3-3l1.5-1.5m1.5 1.5l1.5-1.5" stroke="#ecd53f" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** PDF File */
function PdfIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#f87171" opacity={0.15} stroke="#ef4444" strokeWidth="1.5" />
      <path d="M14 2v6h6" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="6.5" y="17" fill="#ef4444" fontSize="6.5" fontWeight="700" fontFamily="sans-serif">PDF</text>
    </svg>
  );
}

/** Archive: Zip */
function ArchiveIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2" fill="#ca8a04" opacity={0.15} stroke="#eab308" strokeWidth="1.5" />
      <path d="M10 3v18M10 6h4M10 9h4M10 12h4M10 15h4" stroke="#eab308" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Gear / Config */
function GearIcon({ size, color = '#858585', className }: { size: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Plain Text File */
function TextFileIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#ffffff" opacity={0.06} stroke="#858585" strokeWidth="1.5" />
      <path d="M14 2v6h6" stroke="#858585" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 12h8M8 16h6" stroke="#858585" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Default Document Fallback */
function DefaultDocumentIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#ffffff" opacity={0.05} stroke="#a0a0a0" strokeWidth="1.5" />
      <path d="M14 2v6h6" stroke="#a0a0a0" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
