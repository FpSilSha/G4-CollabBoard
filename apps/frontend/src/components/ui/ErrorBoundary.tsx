import React from 'react';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level React Error Boundary.
 * Catches unhandled render errors and displays a fallback UI
 * instead of a blank white screen.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;

      return (
        <div className={styles.container}>
          <div className={styles.card}>
            <h1 className={styles.title}>Something went wrong</h1>
            <p className={styles.message}>
              An unexpected error occurred. Please try reloading the page.
            </p>
            {isDev && this.state.error && (
              <pre className={styles.errorDetail}>
                {this.state.error.message}
              </pre>
            )}
            <div className={styles.actions}>
              <button className={styles.reloadButton} onClick={this.handleReload}>
                Reload Page
              </button>
              <button className={styles.homeButton} onClick={this.handleGoHome}>
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
