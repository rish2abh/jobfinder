import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  Mail,
  Briefcase,
  LogOut,
  User,
  UserCircle,
  Search,
  List,
  Database,
} from 'lucide-react';
import { useUserStore } from '../store/userStore';
import toast from 'react-hot-toast';

const navItems = [
  { to: '/dashboard',               icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/profile',       icon: UserCircle,      label: 'My Profile' },
  { to: '/dashboard/upload',        icon: Upload,          label: 'Upload Resume' },
  { to: '/dashboard/jobs',          icon: Search,          label: 'Job Scraper' },
  { to: '/dashboard/job-listings',  icon: List,            label: 'Job Listings' },
  { to: '/dashboard/cache',         icon: Database,        label: 'Cache Manager' },
  { to: '/dashboard/bulk-mail',     icon: Mail,            label: 'Bulk Mail' },
];

export default function Sidebar() {
  const { user, clearUser } = useUserStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearUser();
    toast.success('Signed out successfully');
    navigate('/');
  };

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-700">
        <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
          <Briefcase className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight">JobFinder</span>
      </div>

      {/* User info */}
      {user && (
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary-600 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-gray-700">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
