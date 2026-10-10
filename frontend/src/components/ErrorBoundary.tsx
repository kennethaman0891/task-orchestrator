"use client";

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Layout } from 'lucide-react';

interface Props {
  children: ReactNode;
  viewName?: string;
  onResetView?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary] Caught error in ${this.props.viewName || 'view'}:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            background: 'rgba(10, 10, 15, 0.95)',
            color: '#e2e8f0',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              padding: 24,
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              maxWidth: 520,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f87171',
              }}
            >
              <AlertTriangle size={24} />
            </div>

            <div>
              <h3 style={{ margin: '0 0 6px 0', fontSize: 16, fontWeight: 600 }}>
                {this.props.viewName ? `Failed to load ${this.props.viewName}` : 'View Error'}
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                onClick={this.handleRetry}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={13} />
                Retry
              </button>

              {this.props.onResetView && (
                <button
                  onClick={this.props.onResetView}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: '1px solid #3b82f6',
                    background: '#3b82f6',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <Layout size={13} />
                  Return to Workspaces
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
