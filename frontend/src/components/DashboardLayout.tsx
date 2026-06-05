import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useUserStore } from '../store/userStore';

export default function DashboardLayout() {
  const { userId } = useUserStore();

  if (!userId) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
