// Shared date utilities and calendar input (used by events).

const POPUP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POPUP_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const POPUP_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const POPUP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function popUpToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidDateStr(s) {
  return POPUP_DATE_RE.test(String(s || ''));
}

function dateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateStr(s) {
  if (!isValidDateStr(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function expandRangeStrs(a, b) {
  if (!isValidDateStr(a) || !isValidDateStr(b)) return [];
  const start = parseDateStr(a);
  const end = parseDateStr(b);
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  const out = [];
  const cursor = new Date(lo);
  while (cursor <= hi) {
    out.push(dateStr(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > 366) break;
  }
  return out;
}

function ensureDates(pop) {
  if (Array.isArray(pop?.dates) && pop.dates.length > 0) {
    return pop.dates.filter(isValidDateStr).sort();
  }
  return expandRangeStrs(pop?.startDate, pop?.endDate);
}

/** Status: 'active' | 'upcoming' | 'past' | 'unknown'. */
function popUpStatus(pop, today = popUpToday()) {
  const dates = ensureDates(pop);
  if (!dates.length) return 'unknown';
  if (dates.includes(today)) return 'active';
  if (today < dates[0]) return 'upcoming';
  if (today > dates[dates.length - 1]) return 'past';
  return 'active';
}

function partitionPopUps(popUps, today = popUpToday()) {
  const active = [];
  const upcoming = [];
  const past = [];
  (popUps || []).forEach((p) => {
    const status = popUpStatus(p, today);
    if (status === 'active') active.push(p);
    else if (status === 'upcoming') upcoming.push(p);
    else if (status === 'past') past.push(p);
  });
  active.sort((a, b) => (ensureDates(a).slice(-1)[0] || '').localeCompare(ensureDates(b).slice(-1)[0] || ''));
  upcoming.sort((a, b) => (ensureDates(a)[0] || '').localeCompare(ensureDates(b)[0] || ''));
  past.sort((a, b) => (ensureDates(b).slice(-1)[0] || '').localeCompare(ensureDates(a).slice(-1)[0] || ''));
  return { active, upcoming, past, activeUpcoming: [...active, ...upcoming] };
}

/** Group sorted dates into runs. Returns [{ start, end }] where start === end for single days. */
function groupDateRuns(sortedDates) {
  const runs = [];
  if (!sortedDates.length) return runs;
  let runStart = sortedDates[0];
  let runEnd = runStart;
  for (let i = 1; i < sortedDates.length; i += 1) {
    const prev = parseDateStr(runEnd);
    const cur = parseDateStr(sortedDates[i]);
    const diffDays = (cur - prev) / 86400000;
    if (diffDays === 1) {
      runEnd = sortedDates[i];
    } else {
      runs.push({ start: runStart, end: runEnd });
      runStart = sortedDates[i];
      runEnd = runStart;
    }
  }
  runs.push({ start: runStart, end: runEnd });
  return runs;
}

/** Format dates ["2026-04-03","04-04","04-05","04-08","04-09","04-15"] → "Apr 3–5, 8, 9, 15". */
function formatPopUpDates(dates) {
  const valid = (Array.isArray(dates) ? dates : []).filter(isValidDateStr).sort();
  if (!valid.length) return '';
  const runs = groupDateRuns(valid);
  const today = parseDateStr(popUpToday());
  const yearStrs = new Set(valid.map((d) => d.slice(0, 4)));
  const currentYear = today ? today.getFullYear() : new Date().getFullYear();
  const includeYear = yearStrs.size > 1 || [...yearStrs].some((y) => Number(y) !== currentYear);
  let lastMonth = -1;
  const parts = runs.map((run) => {
    const a = parseDateStr(run.start);
    const b = parseDateStr(run.end);
    const aMonth = a.getMonth();
    const bMonth = b.getMonth();
    const sameMonth = aMonth === bMonth;
    const monthChanged = aMonth !== lastMonth;
    lastMonth = bMonth;
    const aPrefix = monthChanged ? `${POPUP_MONTH_SHORT[aMonth]} ${a.getDate()}` : String(a.getDate());
    if (run.start === run.end) {
      return includeYear ? `${aPrefix}, ${a.getFullYear()}` : aPrefix;
    }
    const bSuffix = sameMonth ? String(b.getDate()) : `${POPUP_MONTH_SHORT[bMonth]} ${b.getDate()}`;
    const out = `${aPrefix}\u2013${bSuffix}`;
    return includeYear ? `${out}, ${b.getFullYear()}` : out;
  });
  return parts.join(', ');
}

function summarizePopUpLocation(pop) {
  const name = String(pop?.name || '').trim();
  const address = String(pop?.address || '').trim();
  if (name && address) return { primary: name, secondary: address };
  if (name) return { primary: name, secondary: '' };
  if (address) return { primary: address, secondary: '' };
  return { primary: 'Pop-up', secondary: '' };
}

window.popUpToday = popUpToday;
window.popUpStatus = popUpStatus;
window.partitionPopUps = partitionPopUps;
window.formatPopUpDates = formatPopUpDates;
window.ensurePopUpDates = ensureDates;
window.summarizePopUpLocation = summarizePopUpLocation;

function PopUpCalendar({ theme, value, onChange, disabled = false }) {
  const today = popUpToday();
  const initial = React.useMemo(() => {
    if (Array.isArray(value) && value.length > 0 && isValidDateStr(value[0])) {
      const d = parseDateStr(value[0]);
      return { y: d.getFullYear(), m: d.getMonth() };
    }
    const d = parseDateStr(today);
    return { y: d.getFullYear(), m: d.getMonth() };
  }, []);
  const [view, setView] = React.useState(initial);
  const dragRef = React.useRef({ active: false, anchor: null, last: null, baseSet: null, mode: 'add' });

  const valueSet = React.useMemo(() => new Set((value || []).filter(isValidDateStr)), [value]);

  const commitSet = React.useCallback((nextSet) => {
    const arr = Array.from(nextSet).filter(isValidDateStr).sort();
    onChange?.(arr);
  }, [onChange]);

  const stepMonth = (delta) => {
    if (disabled) return;
    setView((v) => {
      const next = v.m + delta;
      if (next < 0) return { y: v.y - 1, m: 11 };
      if (next > 11) return { y: v.y + 1, m: 0 };
      return { y: v.y, m: next };
    });
  };

  const beginPress = (ds) => {
    const baseSet = new Set(valueSet);
    const isSelected = baseSet.has(ds);
    dragRef.current = {
      active: true,
      anchor: ds,
      last: ds,
      baseSet,
      mode: isSelected ? 'remove' : 'add',
    };
  };

  const updatePress = (ds) => {
    const ref = dragRef.current;
    if (!ref.active || !ref.anchor || ref.last === ds) return;
    ref.last = ds;
    const span = expandRangeStrs(ref.anchor, ds);
    const next = new Set(ref.baseSet);
    if (ref.mode === 'add') {
      span.forEach((d) => next.add(d));
    } else {
      span.forEach((d) => next.delete(d));
    }
    commitSet(next);
  };

  const endPress = (ds) => {
    const ref = dragRef.current;
    if (!ref.active) return;
    if (ref.last === ref.anchor) {
      const next = new Set(ref.baseSet);
      if (ref.mode === 'add') next.add(ref.anchor);
      else next.delete(ref.anchor);
      commitSet(next);
    }
    dragRef.current = { active: false, anchor: null, last: null, baseSet: null, mode: 'add' };
  };

  const cancelPress = () => {
    dragRef.current = { active: false, anchor: null, last: null, baseSet: null, mode: 'add' };
  };

  const onPointerDown = (e, ds) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    beginPress(ds);
  };

  const onPointerEnter = (e, ds) => {
    if (!dragRef.current.active) return;
    updatePress(ds);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    const cell = target.closest?.('[data-popup-cell]');
    if (cell) {
      updatePress(cell.getAttribute('data-popup-cell'));
    }
  };

  const onPointerUp = (e, ds) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    endPress(ds);
  };

  const { y: year, m: month } = view;
  const firstDow = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= days; d += 1) cells.push(d);

  return (
    <div style={{ userSelect: 'none', touchAction: 'none', opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => stepMonth(-1)}
          aria-label="Previous month"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: theme.text, fontSize: 18, lineHeight: 1 }}
        >
          &larr;
        </button>
        <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>
          {POPUP_MONTH_NAMES[month]} {year}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => stepMonth(1)}
          aria-label="Next month"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: theme.text, fontSize: 18, lineHeight: 1 }}
        >
          &rarr;
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {POPUP_WEEKDAYS.map((label) => (
          <div key={label} style={{ textAlign: 'center', fontFamily: theme.sans, fontSize: 11, fontWeight: 500, color: theme.muted, padding: '4px 0' }}>{label}</div>
        ))}
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}
        onPointerMove={onPointerMove}
        onPointerCancel={cancelPress}
      >
        {cells.map((d, idx) => {
          if (d == null) return <span key={`e${idx}`} />;
          const ds = dateStr(year, month, d);
          const isSelected = valueSet.has(ds);
          const isToday = ds === today;
          return (
            <button
              type="button"
              key={ds}
              data-popup-cell={ds}
              onPointerDown={(e) => onPointerDown(e, ds)}
              onPointerEnter={(e) => onPointerEnter(e, ds)}
              onPointerUp={(e) => onPointerUp(e, ds)}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: 8,
                border: `1px solid ${isSelected ? theme.accent : (isToday ? theme.border : 'transparent')}`,
                background: isSelected ? theme.accent : 'transparent',
                color: isSelected ? (theme.onAccent || '#fff') : theme.text,
                fontFamily: theme.sans,
                fontSize: 13,
                fontWeight: isSelected ? 600 : (isToday ? 600 : 400),
                cursor: 'pointer',
                padding: 0,
                touchAction: 'none',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontFamily: theme.sans, fontSize: 11, color: theme.muted, lineHeight: 1.4 }}>
        Tap a day to add/remove. Tap and drag to fill a range.
      </div>
    </div>
  );
}

window.PopUpCalendar = PopUpCalendar;

/** Google sign-in bottom sheet — used when anonymous users try to contribute. */
function SignInSheet({ theme, onClose, onSignedIn, reason }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await window.V2Live?.signInWithGoogle?.();
      if (ok) {
        onSignedIn?.();
        onClose?.(true);
        return;
      }
      // Redirect flow started — page will reload.
      setError('Redirecting to Google…');
    } catch (e) {
      const msg = e?.message || 'Could not sign in';
      if (msg !== 'Sign-in cancelled') setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => onClose?.(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-sheet-title"
      style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }}
      onClick={dismiss}
    >
      <div
        style={{ width: '100%', borderRadius: '20px 20px 0 0', background: theme.card, border: `1px solid ${theme.border}`, padding: '22px 20px 36px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 999, background: theme.border, margin: '0 auto 16px' }} />
        <div id="signin-sheet-title" style={{ fontFamily: theme.sans, fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 8 }}>
          Sign in to continue
        </div>
        <div style={{ fontFamily: theme.sans, fontSize: 14, color: theme.muted, lineHeight: 1.45, marginBottom: 20 }}>
          {reason || 'Sign in with Google to post, comment, or save lists. You can still browse without an account.'}
        </div>
        {error ? (
          <div style={{ fontFamily: theme.sans, fontSize: 13, color: '#c0392b', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => { void signIn(); }}
          style={{
            width: '100%',
            padding: '14px 16px',
            borderRadius: 999,
            border: 'none',
            background: busy ? theme.border : theme.accent,
            color: busy ? theme.muted : (theme.onAccent || '#fff'),
            fontFamily: theme.sans,
            fontSize: 15,
            fontWeight: 700,
            cursor: busy ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.1 4 9.3 8.5 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.1 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.2 39.4 16 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.6 7.1l.1.1 6.3 5.3C36.8 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '12px 16px',
            borderRadius: 999,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
            fontFamily: theme.sans,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

window.SignInSheet = SignInSheet;
