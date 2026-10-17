'use client';

import { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { isLightTheme } from '@/lib/theme';
import { imageBlobUrl } from '@/lib/api';
import { Image as ImageIcon, AlertCircle, Download, Check } from 'lucide-react';

interface Props {
  path: string;
  loading?: boolean;
  error?: string | null;
}

/**
 * Read-only image preview for the split editor panel.
 *
 * Uses the backend's /api/file/blob endpoint directly as the <img> src so the
 * browser handles caching and decoding natively — avoids the blob-object-url
 * lifecycle issues that cause "Failed to decode image" in the Tauri webview.
 */
export function ImageViewer({ path, loading, error }: Props) {
  const { theme: t } = useTheme();
  const isLight = isLightTheme(t);
  const bg = isLight ? '#ffffff' : '#1e1e1e';
  const subBg = isLight ? '#f3f3f3' : '#181818';
  const border = isLight ? '#e5e5e5' : '#2d2d2d';
  const text = isLight ? '#000000' : '#d4d4d4';
  const muted = isLight ? '#6c6c6c' : '#858585';

  const [imgError, setImgError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Network-level error (non-200 response) is surfaced via the parent `error` prop;
  // decode-level errors come from the <img> itself.
  const showError = imgError || error;
  const imageUrl = imageBlobUrl(path);
  const fileName = path.split('/').pop() || path;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = fileName;
    a.click();
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1, background: bg,
    }}>
      {/* Sub-header (mirrors CodeEditor's 34px status bar) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderBottom: `1px solid ${border}`,
        background: subBg, flexShrink: 0, height: '34px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <ImageIcon size={13} style={{ color: muted, flexShrink: 0 }} />
          <span style={{ fontSize: t.fontSize.xs, fontWeight: t.fontWeight.medium, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </span>
          <span style={{ fontSize: '11px', color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ({path})
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            fontSize: '10px', fontWeight: 600, color: muted,
            border: `1px solid ${border}`, borderRadius: '10px', padding: '1px 7px', flexShrink: 0,
          }}>
            <Check size={10} />
            <span>Read-only</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleDownload}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', border: 'none',
              borderRadius: '4px', fontSize: '11px', fontWeight: 500,
              cursor: 'pointer', padding: '3px 9px', height: '24px',
              background: subBg, color: text,
              borderLeft: `1px solid ${border}`,
            }}
            title="Download image"
          >
            <Download size={12} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Image body */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: muted }}>
            <div style={{
              width: '18px', height: '18px', border: `2px solid ${border}`,
              borderTopColor: t.colors.accent.primary, borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ fontSize: t.fontSize.xs }}>Loading image...</span>
          </div>
        ) : showError ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            color: t.colors.danger.primary, padding: t.spacing.md, textAlign: 'center',
          }}>
            <AlertCircle size={24} />
            <div style={{ fontSize: t.fontSize.sm, fontWeight: t.fontWeight.medium }}>Unable to load image</div>
            <div style={{ fontSize: t.fontSize.xs, color: muted, maxWidth: '280px' }}>{showError}</div>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={fileName}
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              const status = (e.target as HTMLImageElement).complete && !(e.target as HTMLImageElement).naturalWidth
                ? 'HTTP error — file may not exist or access is denied'
                : 'Failed to decode image';
              setImgError(status);
            }}
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              display: imgLoaded || !showError ? 'block' : 'none',
              boxShadow: `0 2px 12px rgba(0,0,0,${isLight ? 0.15 : 0.5})`,
              borderRadius: '4px',
            }}
          />
        )}
      </div>
    </div>
  );
}
