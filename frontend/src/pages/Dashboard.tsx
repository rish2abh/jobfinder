import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Upload,
  Mail,
  FileText,
  User,
  Calendar,
  ChevronRight,
  RefreshCw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { getUserMe, getUserResume } from '../services/api';
import { useUserStore } from '../store/userStore';
import ResumeViewer from '../components/ResumeViewer';
import MailDashboard from '../components/MailDashboard';
import BackgroundJobs from '../components/BackgroundJobs';

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { userId, user: storedUser } = useUserStore();

  const userQuery = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUserMe(),
    enabled: !!userId,
    initialData: storedUser ?? undefined,
  });

  const resumeQuery = useQuery({
    queryKey: ['resume', userId],
    queryFn: () => getUserResume(userId!),
    enabled: !!userId,
    retry: false,
    // Always re-fetch from server when this query is invalidated
    // (e.g. after a resume parse job completes on the Upload page)
    staleTime: 0,
  });

  const user = userQuery.data;
  const resumeData = resumeQuery.data;
  const hasResume = !!(resumeData?.cloudinaryUrl || resumeData?.rawText);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back{user ? `, ${user.name.split(' ')[0]}` : ''}! 👋
          </h1>
          <p className="text-gray-500 mt-1">
            Here's your job application overview.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            userQuery.refetch();
            resumeQuery.refetch();
          }}
          className="btn-secondary"
          disabled={userQuery.isFetching || resumeQuery.isFetching}
        >
          <RefreshCw className={`w-4 h-4 ${(userQuery.isFetching || resumeQuery.isFetching) ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Profile Status"
          value={user ? 'Active' : 'Setup needed'}
          icon={User}
          color="bg-primary-500"
        />
        <StatCard
          label="Resume"
          value={hasResume ? 'Uploaded' : 'Not uploaded'}
          icon={FileText}
          color={hasResume ? 'bg-green-500' : 'bg-gray-400'}
        />
        <StatCard
          label="Member Since"
          value={
            user?.createdAt
              ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
              : '—'
          }
          icon={Calendar}
          color="bg-purple-500"
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            to="/dashboard/upload"
            className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow group"
          >
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center group-hover:bg-primary-200 transition-colors">
              <Upload className="w-6 h-6 text-primary-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">Upload Resume</p>
              <p className="text-sm text-gray-500">
                {hasResume ? 'Replace your current resume' : 'Upload your PDF to get started'}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
          </Link>

          <Link
            to="/dashboard/bulk-mail"
            className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow group"
          >
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center group-hover:bg-green-200 transition-colors">
              <Mail className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">Send Bulk Mail</p>
              <p className="text-sm text-gray-500">
                {hasResume ? 'Send your resume to multiple companies' : 'Upload resume first to mail'}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
          </Link>
        </div>
      </div>

      {/* Mail Dashboard */}
      <MailDashboard />

      {/* Background Jobs Monitor */}
      <BackgroundJobs />

      {/* Profile info */}
      {user && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Profile</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Full Name</dt>
              <dd className="mt-1 text-sm text-gray-900 font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</dt>
              <dd className="mt-1 text-sm text-gray-900 font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">User ID</dt>
              <dd className="mt-1 text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded">{user._id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Resume Status</dt>
              <dd className="mt-1">
                <span className={`badge ${hasResume ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {hasResume ? '✓ Uploaded' : '— Not uploaded'}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Resume Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Resume Data</h2>
          {resumeQuery.isFetching && (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          )}
        </div>

        {resumeQuery.isLoading && (
          <div className="card p-12 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        )}

        {resumeQuery.isError && !resumeQuery.data && (
          <div className="card p-8 text-center">
            <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No resume found</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">
              Upload a PDF resume to see it parsed and previewed here.
            </p>
            <Link to="/dashboard/upload" className="btn-primary">
              <Upload className="w-4 h-4" /> Upload Resume
            </Link>
          </div>
        )}

        {resumeData && (
          <ResumeViewer data={resumeData} />
        )}
      </div>
    </div>
  );
}
