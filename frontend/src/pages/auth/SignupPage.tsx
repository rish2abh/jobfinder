import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { register as registerApi, getAuthMe } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useUserStore } from '../../store/userStore';

interface SignupValues {
  name: string;
  email: string;
  password: string;
}

export default function SignupPage() {
  const navigate = useNavigate();
  const { setAccessToken } = useAuthStore();
  const { setUser } = useUserStore();

  const form = useForm<SignupValues>();

  const signupMutation = useMutation({
    mutationFn: registerApi,
    onSuccess: async (data) => {
      setAccessToken(data.accessToken);
      try {
        const user = await getAuthMe();
        setUser(user);
      } catch {
        // User info not critical for navigation
      }
      toast.success('Account created successfully!');
      navigate('/dashboard');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const message = error?.response?.data?.message;

      if (status === 409) {
        toast.error('Email already registered. Please sign in.');
        navigate('/auth/login');
      } else {
        toast.error(message || 'Registration failed. Please try again.');
      }
    },
  });

  const onSubmit = (data: SignupValues) => signupMutation.mutate(data);

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Create Account</h2>
      <p className="text-sm text-gray-500 mb-6">
        Sign up to start your AI-powered job search.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="name" className="label">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Alice Johnson"
              className={`input pl-9 ${form.formState.errors.name ? 'border-red-400' : ''}`}
              {...form.register('name', {
                required: 'Name is required',
                minLength: { value: 2, message: 'At least 2 characters' },
              })}
            />
          </div>
          {form.formState.errors.name && (
            <p className="mt-1 text-xs text-red-600">{form.formState.errors.name.message}</p>
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
              autoComplete="new-password"
              placeholder="••••••••"
              className={`input pl-9 ${form.formState.errors.password ? 'border-red-400' : ''}`}
              {...form.register('password', {
                required: 'Password is required',
                minLength: { value: 8, message: 'At least 8 characters' },
                maxLength: { value: 128, message: 'Maximum 128 characters' },
              })}
            />
          </div>
          {form.formState.errors.password && (
            <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">8-128 characters</p>
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
        <Link to="/auth/login" className="text-primary-600 font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
