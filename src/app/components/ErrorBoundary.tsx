import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  isDark?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
  /** Number of chunk-load auto-retries already attempted */
  chunkRetryCount: number;
}

/**
 * Production error boundary — catches render errors in lazy-loaded
 * route components and displays a user-friendly recovery UI instead
 * of a blank white screen.
 *
 * Chunk-load failures (stale cache, transient network) are auto-retried
 * up to MAX_CHUNK_RETRIES times. After exhausting retries, the error UI
 * is shown with a "Reload Page" option.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Maximum chunk-load auto-retries before giving up */
  private static MAX_CHUNK_RETRIES = 2;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: "", chunkRetryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const errorInfo = info.componentStack || "";
    this.setState({ errorInfo });

    // Auto-retry for chunk load failures (stale cache, transient network error)
    const msg = error.message || "";
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Loading chunk") ||
      msg.includes("Loading CSS chunk") ||
      msg.includes("error loading dynamically imported module");

    if (isChunkError && this.state.chunkRetryCount < ErrorBoundary.MAX_CHUNK_RETRIES) {
      console.warn(
        `[ErrorBoundary] Chunk load failure detected — auto-retrying (attempt ${this.state.chunkRetryCount + 1}/${ErrorBoundary.MAX_CHUNK_RETRIES})...`
      );
      // Increment the retry counter and reset the error state to trigger a
      // re-render, which will re-attempt the lazy import (the retryImport
      // wrapper in routes.tsx handles the actual retry logic with backoff)
      setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          errorInfo: "",
          chunkRetryCount: prev.chunkRetryCount + 1,
        }));
      }, 1500);
      return;
    }

    if (isChunkError) {
      console.error(
        `[ErrorBoundary] Chunk load failure persists after ${ErrorBoundary.MAX_CHUNK_RETRIES} retries — showing error UI`
      );
    }

    // Log to console for debugging
    console.error("[ErrorBoundary] Caught render error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: "", chunkRetryCount: 0 });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const isDark = this.props.isDark ?? true;

    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div
          className={`max-w-lg w-full rounded-2xl p-8 text-center border ${
            isDark
              ? "bg-slate-900/50 border-red-500/20 backdrop-blur-sm"
              : "bg-white border-red-200 shadow-lg"
          }`}
        >
          {/* Icon */}
          <div
            className={`w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center ${
              isDark
                ? "bg-red-500/10 border border-red-500/20"
                : "bg-red-50 border border-red-200"
            }`}
          >
            <svg
              className={`w-8 h-8 ${isDark ? "text-red-400" : "text-red-500"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>

          <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
          <p
            className={`text-sm mb-4 ${
              isDark ? "text-slate-400" : "text-gray-500"
            }`}
          >
            A rendering error occurred in this section. This might be a
            temporary issue — try refreshing or navigating back.
          </p>

          {/* Error details (collapsed) */}
          {this.state.error && (
            <details
              className={`text-left mb-5 rounded-xl overflow-hidden border ${
                isDark
                  ? "bg-slate-800/50 border-red-500/10"
                  : "bg-gray-50 border-gray-200"
              }`}
            >
              <summary
                className={`px-4 py-2 cursor-pointer text-xs font-bold ${
                  isDark ? "text-slate-400" : "text-gray-500"
                }`}
              >
                Error Details
              </summary>
              <div className="px-4 pb-3">
                <code
                  className={`text-[11px] block whitespace-pre-wrap break-all ${
                    isDark ? "text-red-400" : "text-red-600"
                  }`}
                >
                  {this.state.error.message}
                </code>
                {this.state.errorInfo && (
                  <code
                    className={`text-[10px] block mt-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto ${
                      isDark ? "text-slate-500" : "text-gray-400"
                    }`}
                  >
                    {this.state.errorInfo.slice(0, 500)}
                  </code>
                )}
              </div>
            </details>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={this.handleReset}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
                isDark
                  ? "bg-slate-800 hover:bg-slate-700 border border-pink-500/20 text-white"
                  : "bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-900"
              }`}
            >
              Try Again
            </button>
            <button
              onClick={this.handleGoHome}
              className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 rounded-xl text-sm font-bold text-white transition-all duration-300 shadow-lg shadow-pink-500/20"
            >
              Go to Dashboard
            </button>
            <button
              onClick={this.handleReload}
              className={`px-5 py-2.5 rounded-xl text-sm transition-all duration-300 ${
                isDark
                  ? "text-slate-400 hover:text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}