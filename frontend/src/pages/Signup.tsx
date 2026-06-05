import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Navigate } from 'react-router-dom';
import { Briefcase, User, Mail, Loader2, ArrowRight, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { createUser, getUserByEmail } from '../services/api';
import { useUserStore } from '../store/userStore';

interface SignupValues {
  name: string;
  email: string;
}

interface LoginValues {
  loginEmail: string;
}

export default function Signup() {
  const navigate = useNavigate();
  const { setUser, userId } = useUserStore();

  // Toggle between "Create account" and "Sign in" tabs
  const [tab, setTab] = useState<'signup' | 'login'>('signup');

  // ── All hooks declared before any conditional return ──────────────────────

  const signupForm = useForm<SignupValues>();
  const loginForm  = useForm<LoginValues>();

  const signupMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (user) => {
      setUser(user);
      toast.success(`Welcome, ${user.name}!`);
      navigate('/dashboard');
    },
    onError: (error: any) => {
      // Email already exists → nudge user to sign in instead
      if (error?.response?.status === 409) {
        setTab('login');
        loginForm.setValue('loginEmail', signupForm.getValues('email'));
        toast.error('Email already registered — sign in below.');
      }
    },
  });

  const loginMutation = useMutation({
    mutationFn: (email: string) => getUserByEmail(email),
    onSuccess: (user) => {
      setUser(user);
      toast.success(`Welcome back, ${user.name}!`);
      navigate('/dashboard');
    },
  });

  // Already logged in → go to dashboard
  if (userId) return <Navigate to="/dashboard" replace />;

  const onSignup = (data: SignupValues) => signupMutation.mutate(data);
  const onLogin  = (data: LoginValues)  => loginMutation.mutate(data.loginEmail.trim());

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

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">

          {/* Tab switcher */}
          <div className="flex border-b border-gray-200">
            <button
              type="button"
              onClick={() => setTab('signup')}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                tab === 'signup'
                  ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => setTab('login')}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                tab === 'login'
                  ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign In
            </button>
          </div>

          <div className="p-8">

            {/* ── Sign up form ──────────────────────────────────────── */}
            {tab === 'signup' && (
              <>
                <p className="text-sm text-gray-500 mb-6">
                  New here? Enter your name and email to get started.
                </p>
                <form onSubmit={signupForm.handleSubmit(onSignup)} className="space-y-4">
                  <div>
                    <label htmlFor="name" className="label">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      <input
                        id="name"
                        type="text"
                        autoComplete="name"
                        placeholder="Alice Johnson"
                        className={`input pl-9 ${signupForm.formState.errors.name ? 'border-red-400' : ''}`}
                        {...signupForm.register('name', {
                          required: 'Name is required',
                          minLength: { value: 2, message: 'At least 2 characters' },
                        })}
                      />
                    </div>
                    {signupForm.formState.errors.name && (
                      <p className="mt-1 text-xs text-red-600">{signupForm.formState.errors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="signup-email" className="label">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      <input
                        id="signup-email"
                        type="email"
                        autoComplete="email"
                        placeholder="alice@example.com"
                        className={`input pl-9 ${signupForm.formState.errors.email ? 'border-red-400' : ''}`}
                        {...signupForm.register('email', {
                          required: 'Email is required',
                          pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: 'Enter a valid email address',
                          },
                        })}
                      />
                    </div>
                    {signupForm.formState.errors.email && (
                      <p className="mt-1 text-xs text-red-600">{signupForm.formState.errors.email.message}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={signupMutation.isPending}
                    className="btn-primary w-full py-2.5 text-base mt-2"
                  >
                    {signupMutation.isPending
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Creating account…</>
                      : <>Create Account <ArrowRight className="w-5 h-5" /></>}
                  </button>
                </form>

                <p className="mt-5 text-center text-xs text-gray-400">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setTab('login')}
                    className="text-primary-600 font-medium hover:underline"
                  >
                    Sign in
                  </button>
                </p>
              </>
            )}

            {/* ── Sign in form ──────────────────────────────────────── */}
            {tab === 'login' && (
              <>
                <p className="text-sm text-gray-500 mb-6">
                  Enter the email you registered with to sign back in.
                </p>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="label">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      <input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        placeholder="alice@example.com"
                        className={`input pl-9 ${loginForm.formState.errors.loginEmail ? 'border-red-400' : ''}`}
                        {...loginForm.register('loginEmail', {
                          required: 'Email is required',
                          pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: 'Enter a valid email address',
                          },
                        })}
                      />
                    </div>
                    {loginForm.formState.errors.loginEmail && (
                      <p className="mt-1 text-xs text-red-600">{loginForm.formState.errors.loginEmail.message}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loginMutation.isPending}
                    className="btn-primary w-full py-2.5 text-base mt-2"
                  >
                    {loginMutation.isPending
                      ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in…</>
                      : <><LogIn className="w-5 h-5" /> Sign In</>}
                  </button>
                </form>

                <p className="mt-5 text-center text-xs text-gray-400">
                  No account yet?{' '}
                  <button
                    type="button"
                    onClick={() => setTab('signup')}
                    className="text-primary-600 font-medium hover:underline"
                  >
                    Create one
                  </button>
                </p>
              </>
            )}

          </div>
        </div>

        {/* Feature hints */}
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          {[
            { emoji: '📄', label: 'Resume Parsing' },
            { emoji: '🤖', label: 'AI Extraction' },
            { emoji: '📧', label: 'Bulk Mailing' },
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
