import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { api, API_BASE_URL } from '../lib/api';
import MemberSearchSelect from '../components/MemberSearchSelect';
import AttendanceTrendChart from '../components/AttendanceTrendChart';

function todayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Yuva Sabha is only ever held on Saturdays, so every date picker in the
// admin panel restricts selection to Saturdays only. This is a pure
// day-of-week check rather than a fixed list, so it keeps working into 2027
// and beyond with no yearly maintenance.
function isSaturday(d) {
  return d.getDay() === 6;
}

// Date inputs elsewhere in this app use IST-calendar-day ISO strings
// ('YYYY-MM-DD'). Parse/format via local Date parts (not Date(iso) /
// toISOString(), which round-trip through UTC and can shift the date by a
// day for admins outside IST).
function isoToLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localDateToIso(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const TODAY = todayIso();

const WEEKDAY_OPTIONS = [
  { value: 'Sun', label: 'Sunday' },
  { value: 'Mon', label: 'Monday' },
  { value: 'Tue', label: 'Tuesday' },
  { value: 'Wed', label: 'Wednesday' },
  { value: 'Thu', label: 'Thursday' },
  { value: 'Fri', label: 'Friday' },
  { value: 'Sat', label: 'Saturday' },
];

function formatDateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatShortDateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function weekdayNameFromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

const GUJARATI_DIGITS = ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'];
function toGujaratiNumber(n) {
  return String(n)
    .split('')
    .map((c) => GUJARATI_DIGITS[Number(c)] ?? c)
    .join('');
}

// India-only numbers are stored as plain 10-digit locals (see server
// seed/admin insert code) — wa.me needs the country code, no other
// formatting (no +, no spaces/dashes).
function buildWhatsAppReminderLink(name, mobile, recentAttendance) {
  const fullName = name.trim();
  const reportLine = recentAttendance.map((r) => (r.present ? '✔' : '✗')).join(' ');
  const message =
    `જય શ્રી સ્વામિનારાયણ ${fullName},\n\n` +
    `આપ આ શનિવારની યુવાસભામાં હાજર રહ્યા નહોતા, તેથી આપની ગેરહાજરી નોંધવામાં આવી છે.\n\n` +
    `આપની છેલ્લા ${toGujaratiNumber(recentAttendance.length)} યુવાસભાની હાજરી: ${reportLine}\n\n` +
    `સ્વામીશ્રીનો આગ્રહ છે કે આપ આવતી યુવાસભામાં અવશ્ય પધારશો.\n\n` +
    `લિ. હરીનગર મંદિર`;
  return `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`;
}

function generateDefaultRemark(targetDateIso, checkinWeekday) {
  const targetWeekday = weekdayNameFromIso(targetDateIso);
  const actualWeekday = WEEKDAY_OPTIONS.find((w) => w.value === checkinWeekday)?.label || targetWeekday;
  return `Yuva Sabha of ${targetWeekday}, ${formatDateLabel(targetDateIso)} was taken on ${actualWeekday} but marked on ${targetWeekday}.`;
}

export default function AdminDashboard() {
  const [date, setDate] = useState(TODAY);
  const [members, setMembers] = useState([]);
  const [attendance, setAttendance] = useState({ present: [], absent: [] });
  const [addMemberId, setAddMemberId] = useState(null);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkinWeekday, setCheckinWeekdayState] = useState(null);
  const [savingWeekday, setSavingWeekday] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleRemark, setRescheduleRemark] = useState('');
  const [activeOverrideDate, setActiveOverrideDate] = useState(null);
  const [savingReschedule, setSavingReschedule] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberMobile, setNewMemberMobile] = useState('');
  const [newMemberGender, setNewMemberGender] = useState('M');
  const [creatingMember, setCreatingMember] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [showAddMemberForm, setShowAddMemberForm] = useState(false);
  const [roster, setRoster] = useState([]);
  const [rosterFilter, setRosterFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingMember, setDeletingMember] = useState(false);
  const [history, setHistory] = useState([]);
  const [absentees, setAbsentees] = useState([]);
  const [absenteeThreshold, setAbsenteeThreshold] = useState(3);
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showFollowupPanel, setShowFollowupPanel] = useState(false);
  const [followupFilter, setFollowupFilter] = useState('');
  const [viewingMemberId, setViewingMemberId] = useState(null);
  const [memberProfile, setMemberProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [showGridPanel, setShowGridPanel] = useState(false);
  const [gridFilter, setGridFilter] = useState('');
  const [grid, setGrid] = useState(null);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [gridError, setGridError] = useState('');
  const navigate = useNavigate();
  const attendanceListsRef = useRef(null);

  function handleSelectTrendDate(iso) {
    setDate(iso);
    attendanceListsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const loadAttendance = useCallback(async (d) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAttendance(d);
      setAttendance(data);
    } catch (err) {
      if (err.message.includes('authenticated') || err.message.includes('expired')) {
        navigate('/admin/login');
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const loadHistory = useCallback(() => {
    api.getAttendanceHistory().then((h) => setHistory(h.weeks)).catch(() => {});
    api.getAbsentees().then((a) => {
      setAbsentees(a.absentees);
      setAbsenteeThreshold(a.threshold);
    }).catch(() => {});
  }, []);

  const loadSettings = useCallback(() => {
    return api.getSettings().then((s) => {
      setCheckinWeekdayState(s.checkinWeekday);
    }).catch((err) => {
      if (err.message.includes('authenticated') || err.message.includes('expired')) {
        navigate('/admin/login');
      }
    });
  }, [navigate]);

  useEffect(() => {
    api.getMembers().then(setMembers).catch(() => {});
    loadSettings();
    api.getReschedule().then((r) => {
      setActiveOverrideDate(r.overrideDate);
      if (r.overrideDate) {
        setRescheduleDate(r.overrideDate);
        setRescheduleRemark(r.remark || '');
        // An active override (not yet expired) means real check-ins right now
        // are landing under r.overrideDate, not today's actual date — jump
        // the default view there so the dashboard doesn't show an empty
        // Present list while a rescheduled session is live.
        if (r.overrideDate >= TODAY) {
          setDate(r.overrideDate);
        }
      }
    }).catch(() => {});
    loadHistory();
  }, [loadHistory, loadSettings]);

  async function handleChangePassword(e) {
    e.preventDefault();
    setNotice('');
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setNotice('Admin password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordPanel(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setChangingPassword(false);
    }
  }

  const checkSession = useCallback(async () => {
    try {
      await api.getSettings();
    } catch {
      navigate('/admin/login');
    }
  }, [navigate]);

  useEffect(() => {
    // A plain setTimeout is unreliable across a real gap (laptop sleep, a
    // backgrounded/throttled tab) — it can be delayed indefinitely or never
    // fire, even though the JWT cookie itself correctly expires server-side
    // after 30 min. Instead, actively re-check the real session: on an
    // interval, and immediately whenever the tab regains focus (e.g. coming
    // back from lunch), so a dead session gets caught right away rather than
    // silently showing stale UI.
    const interval = setInterval(checkSession, 60 * 1000);
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') checkSession();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkSession]);

  useEffect(() => {
    loadAttendance(date);
  }, [date, loadAttendance]);

  const filteredPresent = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return attendance.present;
    return attendance.present.filter((p) => p.name.toLowerCase().includes(q));
  }, [attendance.present, filter]);

  const filteredAbsent = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return attendance.absent;
    return attendance.absent.filter((m) => m.name.toLowerCase().includes(q));
  }, [attendance.absent, filter]);

  async function handleAddMember(e) {
    e.preventDefault();
    if (!addMemberId) return;
    setNotice('');
    setError('');
    try {
      const result = await api.adminCheckin(addMemberId, date);
      setNotice(`Marked ${result.name} present for ${date}.`);
      setAddMemberId(null);
      loadAttendance(date);
      loadHistory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Remove ${name}'s attendance for ${date}?`)) return;
    setError('');
    try {
      await api.deleteAttendance(id);
      loadAttendance(date);
      loadHistory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleWeekdayChange(e) {
    const value = e.target.value;
    const previous = checkinWeekday;
    setCheckinWeekdayState(value);
    setSavingWeekday(true);
    setNotice('');
    setError('');
    try {
      await api.updateCheckinWeekday(value);
      const label = WEEKDAY_OPTIONS.find((w) => w.value === value)?.label;
      setNotice(`Yuva Sabha day updated to ${label}. Self attendance now only opens that day, 9:00-10:00 PM IST.`);
    } catch (err) {
      setCheckinWeekdayState(previous);
      setError(err.message);
    } finally {
      setSavingWeekday(false);
    }
  }

  function handleRescheduleDateChange(value) {
    setRescheduleDate(value);
    if (!rescheduleRemark.trim() && value && checkinWeekday) {
      setRescheduleRemark(generateDefaultRemark(value, checkinWeekday));
    }
  }

  async function handleSaveReschedule(e) {
    e.preventDefault();
    if (!rescheduleDate) return;
    setSavingReschedule(true);
    setNotice('');
    setError('');
    try {
      await api.saveReschedule(rescheduleDate, rescheduleRemark);
      setActiveOverrideDate(rescheduleDate);
      setNotice(`Self attendance will be recorded under ${formatDateLabel(rescheduleDate)} until then.`);
      if (date === rescheduleDate) loadAttendance(date);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingReschedule(false);
    }
  }

  async function handleClearReschedule() {
    setSavingReschedule(true);
    setNotice('');
    setError('');
    try {
      await api.clearReschedule();
      setActiveOverrideDate(null);
      setNotice('Reschedule override cleared — check-ins will use the actual current date again.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingReschedule(false);
    }
  }

  const loadRoster = useCallback(async () => {
    try {
      setRoster(await api.getAdminMembers());
    } catch {
      // panel just shows an empty list; auth failures are caught by checkSession
    }
  }, []);

  function openMembersPanel() {
    setShowMembersPanel(true);
    loadRoster();
  }

  function closeMembersPanel() {
    setShowMembersPanel(false);
    setShowAddMemberForm(false);
    setEditingId(null);
  }

  useEffect(() => {
    if (!showMembersPanel) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeMembersPanel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showMembersPanel]);

  function openFollowupPanel() {
    setShowFollowupPanel(true);
    // Re-fetch on every open (not just once at page load) so a panel opened
    // right after Saturday's session reflects that day's just-recorded
    // attendance immediately.
    loadHistory();
  }

  function closeFollowupPanel() {
    setShowFollowupPanel(false);
    setFollowupFilter('');
  }

  useEffect(() => {
    if (!showFollowupPanel) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeFollowupPanel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showFollowupPanel]);

  function openGridPanel() {
    setShowGridPanel(true);
    setLoadingGrid(true);
    setGridError('');
    api.getAttendanceGrid().then(setGrid).catch((err) => {
      setGridError(err.message);
    }).finally(() => {
      setLoadingGrid(false);
    });
  }

  function closeGridPanel() {
    setShowGridPanel(false);
    setGridFilter('');
  }

  useEffect(() => {
    if (!showGridPanel) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeGridPanel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showGridPanel]);

  const filteredGridMembers = useMemo(() => {
    if (!grid) return [];
    const q = gridFilter.trim().toLowerCase();
    if (!q) return grid.members;
    return grid.members.filter((m) => m.name.toLowerCase().includes(q));
  }, [grid, gridFilter]);

  function openMemberProfile(id) {
    setViewingMemberId(id);
    setMemberProfile(null);
    setProfileError('');
    setLoadingProfile(true);
    api.getMemberHistory(id).then((data) => {
      setMemberProfile(data);
    }).catch((err) => {
      setProfileError(err.message);
    }).finally(() => {
      setLoadingProfile(false);
    });
  }

  function closeMemberProfile() {
    setViewingMemberId(null);
    setMemberProfile(null);
    setProfileError('');
  }

  useEffect(() => {
    if (!viewingMemberId) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') closeMemberProfile();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [viewingMemberId]);

  const filteredAbsentees = useMemo(() => {
    const q = followupFilter.trim().toLowerCase();
    if (!q) return absentees;
    return absentees.filter((a) => a.name.toLowerCase().includes(q));
  }, [absentees, followupFilter]);

  // Fires alongside the WhatsApp link opening (doesn't block or delay it) —
  // just records that the admin clicked "Remind" so the list can show
  // "Reminded 2 days ago" next time, without needing a full page refresh.
  function handleRemind(id) {
    api.markReminded(id).then((result) => {
      setAbsentees((prev) => prev.map((a) => (a.id === id ? { ...a, lastReminded: result.lastReminded } : a)));
    }).catch(() => {});
  }

  async function handleCreateMember(e) {
    e.preventDefault();
    if (!newMemberName.trim()) return;
    setCreatingMember(true);
    setNotice('');
    setError('');
    try {
      const result = await api.addMember(newMemberName, newMemberMobile, newMemberGender);
      setNotice(`Added ${result.name} to the roster (Excel row ${result.sheetRow}).`);
      if (result.excelWarning) setError(result.excelWarning);
      setNewMemberName('');
      setNewMemberMobile('');
      setShowAddMemberForm(false);
      const updated = await api.getMembers();
      setMembers(updated);
      loadRoster();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingMember(false);
    }
  }

  function startEditMember(m) {
    setEditingId(m.id);
    setEditName(m.name);
    setEditMobile(m.mobile || '');
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editName.trim() || editingId === null) return;
    setSavingEdit(true);
    setNotice('');
    setError('');
    try {
      const result = await api.updateMember(editingId, editName, editMobile);
      setNotice(`Updated ${result.name}.`);
      if (result.excelWarning) setError(result.excelWarning);
      setEditingId(null);
      const updated = await api.getMembers();
      setMembers(updated);
      loadRoster();
      loadAttendance(date);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteMember(id, name) {
    if (
      !window.confirm(
        `Remove ${name} from the roster? This also permanently deletes their attendance history and frees up their row in Excel. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingMember(true);
    setNotice('');
    setError('');
    try {
      const result = await api.deleteMember(id);
      setNotice(`Removed ${name} from the roster.`);
      if (result.excelWarning) setError(result.excelWarning);
      setEditingId(null);
      const updated = await api.getMembers();
      setMembers(updated);
      loadRoster();
      loadAttendance(date);
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingMember(false);
    }
  }

  async function handleLogout() {
    await api.adminLogout();
    navigate('/admin/login');
  }

  const total = attendance.present.length + attendance.absent.length;

  return (
    <div className="page admin-page">
      <header className="admin-header">
        <div className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          <div>
            <h1>Admin Dashboard</h1>
            <p className="subtitle">Yuva Sabha attendance</p>
          </div>
        </div>
        <div className="button-row">
          {!showMembersPanel && (
            <button type="button" className="secondary" onClick={openMembersPanel}>
              Members
            </button>
          )}
          {!showFollowupPanel && (
            <button type="button" className="secondary" onClick={openFollowupPanel}>
              Needs follow-up{absentees.length > 0 ? ` (${absentees.length})` : ''}
            </button>
          )}
          {!showGridPanel && (
            <button type="button" className="secondary" onClick={openGridPanel}>
              Attendance report
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              window.location.href = `${API_BASE_URL}/api/admin/excel`;
            }}
          >
            Download Excel
          </button>
          <button type="button" className="secondary" onClick={() => setShowPasswordPanel(true)}>
            Change password
          </button>
          <button type="button" className="link-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {showPasswordPanel && (
        <div className="modal-backdrop" onClick={() => setShowPasswordPanel(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="Change admin password"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2>Change password</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => setShowPasswordPanel(false)}
              >
                ✕
              </button>
            </div>
            <form className="modal-add-form" onSubmit={handleChangePassword}>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <div className="button-row">
                <button type="submit" disabled={changingPassword}>
                  {changingPassword ? 'Saving...' : 'Save password'}
                </button>
                <button type="button" className="secondary" onClick={() => setShowPasswordPanel(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="admin-add">
        <h2>Yuva Sabha day</h2>
        <form className="weekday-form" onSubmit={(e) => e.preventDefault()}>
          <label className="weekday-label">
            Self attendance opens on
            {checkinWeekday && (
              <select value={checkinWeekday} onChange={handleWeekdayChange} disabled={savingWeekday}>
                {WEEKDAY_OPTIONS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
          </label>
          {savingWeekday && <span className="spinner" aria-hidden="true" />}
        </form>
        {checkinWeekday && checkinWeekday !== 'Sat' && (
          <div className="banner warning" style={{ marginTop: '0.75rem' }}>
            <span aria-hidden="true">⚠️</span>
            <span>
              Self attendance currently opens on{' '}
              {WEEKDAY_OPTIONS.find((w) => w.value === checkinWeekday)?.label}s, not the usual Saturday.
              If this was only for one week, switch it back to Saturday once done — otherwise next
              Saturday's self check-in won't open.
            </span>
          </div>
        )}
      </section>

      <section>
        <h2>Reschedule this week</h2>
        <form onSubmit={handleSaveReschedule}>
          <label>
            Record attendance under (a Saturday)
            <DatePicker
              selected={isoToLocalDate(rescheduleDate)}
              onChange={(d) => handleRescheduleDateChange(localDateToIso(d))}
              filterDate={isSaturday}
              dateFormat="dd/MM/yyyy"
              placeholderText="Select a Saturday"
              className="date-input"
            />
          </label>
          <label>
            Remark shown for that date
            <input
              type="text"
              value={rescheduleRemark}
              onChange={(e) => setRescheduleRemark(e.target.value)}
              placeholder="e.g. Yuva Sabha was taken on Friday but marked on Saturday."
            />
          </label>
          <div className="button-row">
            <button type="submit" disabled={!rescheduleDate || savingReschedule}>
              {savingReschedule ? 'Saving...' : 'Save'}
            </button>
            {activeOverrideDate && (
              <button
                type="button"
                className="secondary"
                onClick={handleClearReschedule}
                disabled={savingReschedule}
              >
                Clear override
              </button>
            )}
          </div>
        </form>
      </section>

      <div className="admin-controls">
        <label>
          Date
          <DatePicker
            selected={isoToLocalDate(date)}
            onChange={(d) => setDate(localDateToIso(d))}
            filterDate={isSaturday}
            dateFormat="dd/MM/yyyy"
            className="date-input"
          />
        </label>
        {date !== TODAY && (
          <button type="button" className="secondary" onClick={() => setDate(TODAY)}>
            Today
          </button>
        )}
      </div>

      {notice && (
        <div className="banner success">
          <span aria-hidden="true">✓</span>
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="banner error">
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
        </div>
      )}
      {attendance.remark && (
        <div className="banner info">
          <span aria-hidden="true">📝</span>
          <span>{attendance.remark}</span>
        </div>
      )}

      {total > 0 && (
        <div className="stat-row">
          <div className="stat-card">
            <div className="stat-value">{total}</div>
            <div className="stat-label">Members</div>
          </div>
          <div className="stat-card present">
            <div className="stat-value">{attendance.present.length}</div>
            <div className="stat-label">Present</div>
          </div>
          <div className="stat-card absent">
            <div className="stat-value">{attendance.absent.length}</div>
            <div className="stat-label">Absent</div>
          </div>
        </div>
      )}

      <section>
        <h2>Attendance trend</h2>
        <AttendanceTrendChart weeks={history} totalMembers={members.length} onSelectDate={handleSelectTrendDate} />
      </section>

      {showFollowupPanel && (
        <div className="modal-backdrop" onClick={closeFollowupPanel}>
          <div
            className="modal"
            role="dialog"
            aria-label="Needs follow-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2>Needs follow-up ({absentees.length})</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={closeFollowupPanel}
              >
                ✕
              </button>
            </div>
            <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.75rem' }}>
              Missed the last {absenteeThreshold}+ Yuva Sabhas in a row.
            </p>

            <input
              type="text"
              className="modal-search"
              placeholder="Search members..."
              value={followupFilter}
              onChange={(e) => setFollowupFilter(e.target.value)}
            />

            <ul className="attendance-list modal-roster">
              {filteredAbsentees.map((a) => (
                <li key={a.id}>
                  <button type="button" className="link-button member-name-link" onClick={() => openMemberProfile(a.id)}>
                    {a.name}
                  </button>
                  <span className="muted-text">
                    {a.lastPresent ? `Last present ${formatDateLabel(a.lastPresent)}` : 'Never attended'}
                  </span>
                  <span className="badge absentee-streak">{a.streak} in a row</span>
                  {a.lastReminded && (
                    <span className="muted-text">Reminded {formatTimestamp(a.lastReminded)}</span>
                  )}
                  {a.mobile ? (
                    <a
                      className="link-button"
                      href={buildWhatsAppReminderLink(a.name, a.mobile, a.recentAttendance)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleRemind(a.id)}
                    >
                      Remind
                    </a>
                  ) : (
                    <span className="muted-text" title="No mobile number on file">
                      No mobile
                    </span>
                  )}
                </li>
              ))}
              {filteredAbsentees.length === 0 && <li className="muted">No matches.</li>}
            </ul>
          </div>
        </div>
      )}

      {showGridPanel && (
        <div className="modal-backdrop" onClick={closeGridPanel}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-label="Attendance report"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2>Attendance report</h2>
              <button type="button" className="icon-button" aria-label="Close" onClick={closeGridPanel}>
                ✕
              </button>
            </div>

            {loadingGrid && <p className="muted">Loading attendance report...</p>}
            {gridError && <div className="banner error">{gridError}</div>}

            {grid && (
              <>
                <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.75rem' }}>
                  Most recent Yuva Sabha first, {grid.dates.length} recorded so far.
                </p>

                <input
                  type="text"
                  className="modal-search"
                  placeholder="Search members..."
                  value={gridFilter}
                  onChange={(e) => setGridFilter(e.target.value)}
                />

                {grid.dates.length === 0 ? (
                  <p className="muted">No attendance recorded yet.</p>
                ) : (
                  <div className="grid-table-wrap">
                    <table className="grid-table">
                      <thead>
                        <tr>
                          <th className="grid-table-name-col">Name</th>
                          {grid.dates.map((d) => (
                            <th key={d} className={d === TODAY ? 'grid-table-today' : undefined} title={formatDateLabel(d)}>
                              {formatShortDateLabel(d)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredGridMembers.map((m) => (
                          <tr key={m.id}>
                            <td className="grid-table-name-col">
                              <button
                                type="button"
                                className="link-button member-name-link"
                                onClick={() => openMemberProfile(m.id)}
                              >
                                {m.name}
                              </button>
                            </td>
                            {m.attendance.map((present, i) => (
                              <td
                                key={grid.dates[i]}
                                className={
                                  present === true ? 'grid-cell-present' : present === false ? 'grid-cell-absent' : 'grid-cell-blank'
                                }
                              >
                                {present === true ? '✔' : present === false ? '✗' : '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {filteredGridMembers.length === 0 && (
                          <tr>
                            <td className="grid-table-name-col muted">No matches.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showMembersPanel && (
        <div className="modal-backdrop" onClick={closeMembersPanel}>
          <div
            className="modal"
            role="dialog"
            aria-label="Manage members"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2>Members ({roster.length})</h2>
              <div className="button-row">
                {!showAddMemberForm && (
                  <button type="button" className="secondary" onClick={() => setShowAddMemberForm(true)}>
                    Add Member
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close"
                  onClick={closeMembersPanel}
                >
                  ✕
                </button>
              </div>
            </div>

            {showAddMemberForm && (
              <form className="modal-add-form" onSubmit={handleCreateMember}>
                <label>
                  Name
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    autoFocus
                  />
                </label>
                <label>
                  Mobile number (optional)
                  <input
                    type="text"
                    value={newMemberMobile}
                    onChange={(e) => setNewMemberMobile(e.target.value)}
                  />
                </label>
                <label>
                  Gender
                  <select value={newMemberGender} onChange={(e) => setNewMemberGender(e.target.value)}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </label>
                <div className="button-row">
                  <button type="submit" disabled={!newMemberName.trim() || creatingMember}>
                    {creatingMember ? 'Adding...' : 'Add member'}
                  </button>
                  <button type="button" className="secondary" onClick={() => setShowAddMemberForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <input
              type="text"
              className="modal-search"
              placeholder="Search members..."
              value={rosterFilter}
              onChange={(e) => setRosterFilter(e.target.value)}
            />

            <ul className="attendance-list modal-roster">
              {roster
                .filter((m) => {
                  const q = rosterFilter.trim().toLowerCase();
                  return !q || m.name.toLowerCase().includes(q) || (m.mobile || '').includes(q);
                })
                .map((m) =>
                  editingId === m.id ? (
                    <li key={m.id} className="roster-edit-row">
                      <form className="roster-edit-form" onSubmit={handleSaveEdit}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editMobile}
                          onChange={(e) => setEditMobile(e.target.value)}
                          placeholder="Mobile (optional)"
                        />
                        <div className="button-row">
                          <button type="submit" disabled={!editName.trim() || savingEdit || deletingMember}>
                            {savingEdit ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit || deletingMember}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteMember(m.id, m.name)}
                            disabled={savingEdit || deletingMember}
                          >
                            {deletingMember ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={m.id}>
                      <button type="button" className="link-button member-name-link" onClick={() => openMemberProfile(m.id)}>
                        {m.name}
                      </button>
                      <span className="muted-text">{m.mobile || 'No mobile'}</span>
                      <button type="button" className="link-button" onClick={() => startEditMember(m)}>
                        Edit
                      </button>
                    </li>
                  )
                )}
              {roster.length === 0 && <li className="muted">Loading members...</li>}
            </ul>
          </div>
        </div>
      )}

      {viewingMemberId && (
        <div className="modal-backdrop" onClick={closeMemberProfile}>
          <div
            className="modal"
            role="dialog"
            aria-label="Member attendance profile"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h2>{memberProfile ? memberProfile.name : 'Member profile'}</h2>
              <button type="button" className="icon-button" aria-label="Close" onClick={closeMemberProfile}>
                ✕
              </button>
            </div>

            {loadingProfile && <p className="muted">Loading attendance history...</p>}
            {profileError && <div className="banner error">{profileError}</div>}

            {memberProfile && (
              <>
                <div className="stat-row">
                  <div className="stat-card present">
                    <div className="stat-value">{memberProfile.presentCount}</div>
                    <div className="stat-label">Present</div>
                  </div>
                  <div className="stat-card absent">
                    <div className="stat-value">{memberProfile.totalCount - memberProfile.presentCount}</div>
                    <div className="stat-label">Absent</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{memberProfile.percentage ?? '—'}%</div>
                    <div className="stat-label">Attendance</div>
                  </div>
                </div>

                {memberProfile.history.length === 0 ? (
                  <p className="muted" style={{ marginTop: '0.75rem' }}>
                    No recorded Yuva Sabhas since this member joined yet.
                  </p>
                ) : (
                  <table className="trend-table" style={{ marginTop: '0.75rem' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...memberProfile.history].reverse().map((h) => (
                        <tr key={h.date}>
                          <td>{formatDateLabel(h.date)}</td>
                          <td>{h.present ? '✔ Present' : '✗ Absent'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <section className="admin-add">
        <h2>Admin-assisted attendance</h2>
        <form onSubmit={handleAddMember}>
          <MemberSearchSelect members={members} value={addMemberId} onChange={setAddMemberId} />
          <button type="submit" disabled={!addMemberId}>
            Mark present
          </button>
        </form>
      </section>

      {loading ? (
        <p className="banner info" style={{ marginTop: '1.25rem' }}>
          <span className="spinner" aria-hidden="true" /> Loading attendance...
        </p>
      ) : (
        <>
          <div className="filter-row">
            <input
              type="text"
              placeholder="Filter names..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="admin-lists" ref={attendanceListsRef}>
            <section>
              <h2>Present ({filteredPresent.length})</h2>
              <ul className="attendance-list">
                {filteredPresent.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="link-button member-name-link" onClick={() => openMemberProfile(p.memberId)}>
                      {p.name}
                    </button>
                    <span className={`badge ${p.source}`}>
                      {p.source === 'self-checkin' ? 'Self attendance' : 'Admin-assisted'}
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => handleDelete(p.id, p.name)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {filteredPresent.length === 0 && <li className="muted">No matches.</li>}
              </ul>
            </section>

            <section>
              <h2>Absent ({filteredAbsent.length})</h2>
              <ul className="attendance-list">
                {filteredAbsent.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="link-button member-name-link" onClick={() => openMemberProfile(m.id)}>
                      {m.name}
                    </button>
                  </li>
                ))}
                {filteredAbsent.length === 0 && <li className="muted">No matches.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
