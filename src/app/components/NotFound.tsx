import { Link } from "react-router";
import { useTheme } from "../contexts/ThemeContext";
import { ArrowLeft, AlertCircle } from "lucide-react";

export function NotFound() {
  const { isDark } = useTheme();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div
        className={`rounded-2xl p-8 sm:p-12 max-w-md w-full border ${
          isDark
            ? "bg-[#0d0f1a]/80 border-white/[0.06]"
            : "bg-white border-gray-200"
        }`}
      >
        <div className="flex justify-center mb-6">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center ${
              isDark ? "bg-red-500/10" : "bg-red-50"
            }`}
          >
            <AlertCircle className={`w-8 h-8 ${isDark ? "text-red-400" : "text-red-500"}`} />
          </div>
        </div>

        <h1
          className={`text-5xl font-bold tracking-tight mb-2 ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          404
        </h1>
        <p className={`text-lg mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
          Page Not Found
        </p>
        <p className={`text-sm mb-8 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
          The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
        </p>

        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 transition-all shadow-lg shadow-pink-500/20"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
