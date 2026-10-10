import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { isTauri, tauri } from '../lib/tauri';
type GatewayIdentity = any;

/**
 * Devices — remote access control plane.
 *
 * Shows this desktop's gateway connection state and drives the pairing flow:
 *   1. Enter the gateway URL (wss://…) → "Start pairing"
 *   2. A short code appears; approve it on the gateway (web/phone side)
 *   3. "Check & claim" polls the gateway, signs the challenge with this
 *      device's private key, and stores the credential — after which the
 *      background worker connects and the device shows 🟢 Online remotely.
 *
 * Pairing never exposes the private key; the UI only ever sees the code and
 * non-secret identity fields.
 */

const STATES: Record<string, { label: string; cls: string }> = {
  CONNECTED: { label: '🟢 Connected', cls: 'gw-state-connected' },
  CONNECTING: { label: '🟡 Connecting…', cls: 'gw-state-connecting' },
  RECONNECTING: { label: '🟡 Reconnecting…', cls: 'gw-state-connecting' },
  OFFLINE: { label: '🔴 Offline', cls: 'gw-state-offline' },
  DISABLED: { label: '⚪ Disabled', cls: 'gw-state-offline' },
};

export function DevicesView({ onToast }: { onToast: (msg: string, error?: boolean) => void }) {
  const [identity, setIdentity] = useState<GatewayIdentity | null>(null);
  const [state, setState] = useState('OFFLINE');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  // Render the pairing QR — payload contract from gateway/src/pairing.ts and
  // the TTO mobile spec: ONLY { gatewayUrl, code }. The phone (Android/iOS)
  // scans it to confirm pairing; the desktop polls, sees `used`, and claims
  // its credential automatically — no typing, no port forwarding.
  useEffect(() => {
    if (!pairing || !qrRef.current) return;
    const payload = JSON.stringify({
      gatewayUrl: gatewayUrl.trim(),
      code: pairing.code,
    });
    QRCode.toCanvas(qrRef.current, payload, {
      width: 176,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0b0b', light: '#ffffff' },
    }).catch(() => {
      /* QR render failure is non-fatal — the code text is still shown */
    });
  }, [pairing, gatewayUrl]);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const [ident, st] = await Promise.all([tauri.gatewayIdentity(), tauri.gatewayStatus()]);
      setIdentity(ident);
      setState(st.replace(/"/g, ''));
      if (ident?.gatewayUrl && !gatewayUrl) setGatewayUrl(ident.gatewayUrl);
    } catch {
      /* gateway IPC unavailable (non-Tauri dev) */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll pairing status while a code is pending.
  useEffect(() => {
    if (!pairing || !isTauri()) return;
    pollRef.current = setInterval(async () => {
      try {
        const st = await tauri.gatewayPairStatus();
        if (st.status === 'approved') {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy('claim');
          const claim = await tauri.gatewayPair(st.code);
          setBusy('');
          if (claim.ok) {
            setPairing(null);
            onToast('Paired! Connecting to gateway…');
            void refresh();
          } else {
            onToast(`Pairing claim failed: ${claim.error || 'unknown'}`, true);
          }
        } else if (st.status === 'expired' || st.status === 'denied') {
          if (pollRef.current) clearInterval(pollRef.current);
          setPairing(null);
          onToast(`Pairing ${st.status}`, true);
        }
      } catch {
        /* transient network error — keep polling */
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, gatewayUrl]);

  const startPairing = async () => {
    if (!gatewayUrl.trim()) {
      onToast('Enter the gateway URL first (e.g. wss://gateway.example.com)', true);
      return;
    }
    setBusy('pair');
    try {
      const start = await tauri.gatewayPair(gatewayUrl.trim());
      setPairing({ code: start.code, expiresAt: start.expires_at });
      onToast(`Pairing code ${start.code} — approve it on the gateway`);
    } catch (e) {
      onToast(`Pairing failed: ${(e as Error).message}`, true);
    } finally {
      setBusy('');
    }
  };

  const st = STATES[state] || STATES.OFFLINE;

  return (
    <div className="container devices-wrap">
      <h1 className="devices-title">My Devices</h1>

      <div className="devices-card">
        <div className="devices-card-head">
          <span className="devices-device-icon">🖥️</span>
          <div className="devices-device-meta">
            <div className="devices-device-name">{identity?.deviceName || 'This computer'}</div>
            <div className="devices-device-id" title={identity?.deviceId}>
              {identity?.deviceId || '—'}
            </div>
          </div>
          <span className={`devices-state ${st.cls}`}>{st.label}</span>
        </div>

        <div className="devices-card-body">
          <label className="devices-label" htmlFor="gw-url">
            Gateway URL
          </label>
          <div className="devices-url-row">
            <input
              id="gw-url"
              className="devices-url"
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              placeholder="wss://gateway.example.com"
              spellCheck={false}
              autoComplete="off"
            />
            <button className="devices-btn" onClick={() => void tauri.gatewaySetUrl(gatewayUrl.trim()).then(refresh)}>
              Save
            </button>
          </div>

          {!pairing ? (
            <button className="devices-btn primary" disabled={busy === 'pair'} onClick={() => void startPairing()}>
              {busy === 'pair' ? 'Starting…' : 'Connect a device (pair)'}
            </button>
          ) : (
            <div className="devices-pairing">
              <div className="devices-qr-row">
                <canvas
                  ref={qrRef}
                  className="devices-qr"
                  aria-label="Pairing QR code — scan with the TTO mobile app"
                />
                <div className="devices-qr-side">
                  <div className="devices-pairing-code" title="Approve this code on the gateway">
                    {pairing.code}
                  </div>
                  <div className="devices-qr-hint">
                    Scan with the <b>TTO mobile app</b> (Android / iOS) to pair this computer
                    with your phone — or type the code on the gateway's web page.
                  </div>
                </div>
              </div>
              <div className="devices-pairing-hint">
                Approve this code on your phone / the gateway web page within the expiry window.
                Claiming happens automatically once approved.
              </div>
              <button
                className="devices-btn ghost"
                onClick={() => {
                  setPairing(null);
                  if (pollRef.current) clearInterval(pollRef.current);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="devices-note">
        The desktop connects <b>outbound</b> to the gateway — no port forwarding, no public shell
        port. Remote clients (phone, web) reach this machine only through the authenticated
        gateway relay.
      </p>
    </div>
  );
}
