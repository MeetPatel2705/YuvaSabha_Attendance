import { Routes, Route, Navigate } from 'react-router-dom';
import CheckIn from './pages/CheckIn';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import Splash from './components/Splash';

export default function App() {
  return (
    <>
      <Splash />
      <Routes>
        <Route path="/" element={<CheckIn />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
