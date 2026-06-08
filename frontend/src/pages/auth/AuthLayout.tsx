import { Outlet, Navigate } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

export default function AuthLayout() {
  const { accessToken } = useAuthStore();

  if (accessToken) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 via-primary-800 to-primary-700 flex items-center justify-center p-4">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur rounded-2xl mb-4">
            <Briefcase className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">JobFinder</h1>
          <p className="text-primary-200 mt-1">AI-powered resume &amp; job matching</p>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <Outlet />
        </div>

        {/* Feature hints */}
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          {[
            { emoji: '📄', label: 'Resume Parsing' },
            { emoji: '🤖', label: 'AI Matching' },
            { emoji: '📧', label: 'Auto Apply' },
          ].map(({ emoji, label }) => (
            <div key={label} className="bg-white/10 backdrop-blur rounded-xl p-3">
              <div className="text-2xl mb-1">{emoji}</div>
              <p className="text-xs text-primary-100 font-medium">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
