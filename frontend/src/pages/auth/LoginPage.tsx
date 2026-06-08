import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Loader2, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { login, getAuthMe } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useUserStore } from '../../store/userStore';

interface LoginValues {
  email: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAccessToken } = useAuthStore();
  const { setUser } = useUserStore();

  const form = useForm<LoginValues>();

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async (data) => {
      setAccessToken(data.accessToken);
      try {
        const user = await getAuthMe();
        setUser(user);
      } catch {
        // User info not critical for navigation
      }
      toast.success('Welcome back!');
      navigate('/dashboard');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const message = error?.response?.data?.message;

      if (status === 401) {
        toast.error(message || 'Invalid email or password.');
      } else if (status === 423 || message?.toLowerCase().includes('locked')) {
        toast.error('Account locked. Please try again later.');
      } else {
        toast.error(message || 'Login failed. Please try again.');
      }
    },
  });

  const onSubmit = (data: LoginValues) => loginMutation.mutate(data);

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Sign In</h2>
      <p className="text-sm text-gray-500 mb-6">
        Enter your credentials to access your account.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="email" className="label">Email Address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="alice@example.com"
              className={`input pl-9 ${form.formState.errors.email ? 'border-red-400' : ''}`}
              {...form.register('email', {
                required: 'Email is required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Enter a valid email address',
                },
              })}
            />
          </div>
          {form.formState.errors.email && (
            <p className="mt-1 text-xs text-red-600">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="label">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className={`input pl-9 ${form.formState.errors.password ? 'border-red-400' : ''}`}
              {...form.register('password', {
                required: 'Password is required',
              })}
            />
          </div>
          {form.formState.errors.password && (
            <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p>
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
        Don't have an account?{' '}
        <Link to="/auth/register" className="text-primary-600 font-medium hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
