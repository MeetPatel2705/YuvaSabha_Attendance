import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getDeviceId } from '../lib/deviceId';
import MemberSearchSelect from '../components/MemberSearchSelect';

const now = new Date();
const todayLabel = now.toLocaleDateString('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function todayIsoIst() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatDateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function CheckIn() {
  const [members, setMembers] = useState([]);
  const [memberId, setMemberId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | locating | submitting | success | error
  const [message, setMessage] = useState('');
  const [presentName, setPresentName] = useState('');
  const [presentDate, setPresentDate] = useState('');

  useEffect(() => {
    api.getMembers().then(setMembers).catch(() => setMessage('Could not load member list.'));
    // Restore the success screen if this device already checked someone in today.
    api.checkinStatus(getDeviceId()).then((s) => {
      if (s.checkedIn) {
        setPresentName(s.name);
        setPresentDate(s.date);
        setStatus('success');
      }
    }).catch(() => {});
  }, []);

  const selectedMember = members.find((m) => m.id === memberId);

  function handleSubmit(e) {
    e.preventDefault();
    if (!memberId) {
      setStatus('error');
      setMessage('Please select your name first.');
      return;
    }

    if (!('geolocation' in navigator)) {
      setStatus('error');
      setMessage('Your browser does not support location access, required for attendance.');
      return;
    }

    setStatus('locating');
    setMessage('Checking your location...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setStatus('submitting');
        setMessage('Marking you present...');
        try {
          const result = await api.checkin({
            memberId,
            deviceId: getDeviceId(),
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setStatus('success');
          setPresentName(result.name);
          setPresentDate(result.date);
        } catch (err) {
          setStatus('error');
          setMessage(err.message);
        }
      },
      () => {
        setStatus('error');
        setMessage('Could not get your location. Please enable location permission and try again.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  const busy = status === 'locating' || status === 'submitting';

  return (
    <div className="page checkin-page">
      <header className="checkin-header">
        <img src="/logo.png" alt="Shree Swaminarayan Mandir, Harinagar" className="site-logo" />
        <p className="eyebrow">Harinagar Mandir</p>
        <h1>Yuva Sabha Attendance</h1>
        <p className="greeting">Jay Shree Swaminarayan</p>
        <p className="date-line">{todayLabel}</p>
      </header>

      {status === 'success' ? (
        <div className="success-card">
          <div className="success-check" aria-hidden="true">✓</div>
          <p className="success-title">Marked present</p>
          <p className="success-subtext">
            {presentName}
            {presentDate && presentDate !== todayIsoIst()
              ? ` — counted for ${formatDateLabel(presentDate)}`
              : ''}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="checkin-form">
          <label>
            Your name
            <MemberSearchSelect
              members={members}
              value={memberId}
              onChange={(id) => {
                setMemberId(id);
                if (status === 'error') {
                  setStatus('idle');
                  setMessage('');
                }
              }}
            />
          </label>

          {selectedMember && (
            <p className="selected-confirm">
              Marking present for <strong>{selectedMember.name}</strong>
            </p>
          )}

          {status === 'error' && (
            <div className="banner error" role="alert">
              {message}
            </div>
          )}
          {busy && (
            <div className="banner info">
              <span className="spinner" aria-hidden="true" />
              <span>{message}</span>
            </div>
          )}

          <button type="submit" className="present-button" disabled={busy || !memberId}>
            {busy ? 'Please wait...' : 'Mark me present'}
          </button>
        </form>
      )}
    </div>
  );
}
