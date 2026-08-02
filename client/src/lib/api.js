// Defaults to same-origin relative paths (local dev via the Vite proxy, or
// any single-process deployment where the server also serves the built
// client). Set at build time when the client and server are on different
// origins (e.g. client on Vercel, server on Render) — see "Frontend and
// backend on different origins" in DEPLOY.md.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  getMembers: () => request('/members'),
  checkin: (body) => request('/attendance/checkin', { method: 'POST', body: JSON.stringify(body) }),
  checkinStatus: (deviceId) =>
    request(`/attendance/checkin/status?deviceId=${encodeURIComponent(deviceId)}`),
  adminLogin: (password) =>
    request('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),
  adminLogout: () => request('/admin/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/admin/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  getAttendance: (date) => request(`/admin/attendance?date=${encodeURIComponent(date)}`),
  getAttendanceHistory: () => request('/admin/attendance/history'),
  getAttendanceGrid: () => request('/admin/attendance/grid'),
  getAbsentees: () => request('/admin/attendance/absentees'),
  adminCheckin: (memberId, date) =>
    request('/admin/checkin', { method: 'POST', body: JSON.stringify({ memberId, date }) }),
  deleteAttendance: (id) => request(`/admin/attendance/${id}`, { method: 'DELETE' }),
  getSettings: () => request('/admin/settings'),
  updateCheckinWeekday: (checkinWeekday) =>
    request('/admin/settings', { method: 'POST', body: JSON.stringify({ checkinWeekday }) }),
  getReschedule: () => request('/admin/reschedule'),
  saveReschedule: (overrideDate, remark) =>
    request('/admin/reschedule', { method: 'POST', body: JSON.stringify({ overrideDate, remark }) }),
  clearReschedule: () => request('/admin/reschedule/clear', { method: 'POST' }),
  addMember: (name, mobile, gender, occupation) =>
    request('/admin/members', { method: 'POST', body: JSON.stringify({ name, mobile, gender, occupation }) }),
  getAdminMembers: () => request('/admin/members'),
  updateMember: (id, name, mobile, occupation) =>
    request(`/admin/members/${id}`, { method: 'PUT', body: JSON.stringify({ name, mobile, occupation }) }),
  deleteMember: (id) => request(`/admin/members/${id}`, { method: 'DELETE' }),
  markReminded: (id) => request(`/admin/members/${id}/remind`, { method: 'POST' }),
  getMemberHistory: (id) => request(`/admin/members/${id}/history`),
};
