import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import BulkMail from './pages/BulkMail';
import Profile from './pages/Profile';
import Jobs from './pages/Jobs';
import JobListings from './pages/JobListings';
import Cache from './pages/Cache';
import DashboardLayout from './components/DashboardLayout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Signup />} />
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="profile"       element={<Profile />} />
            <Route path="upload"        element={<Upload />} />
            <Route path="bulk-mail"     element={<BulkMail />} />
            <Route path="jobs"          element={<Jobs />} />
            <Route path="job-listings"  element={<JobListings />} />
            <Route path="cache"         element={<Cache />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { background: '#1f2937', color: '#f9fafb', borderRadius: '10px', fontSize: '14px' },
          success: { iconTheme: { primary: '#22c55e', secondary: '#f9fafb' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#f9fafb' } },
        }}
      />
    </QueryClientProvider>
  );
}
