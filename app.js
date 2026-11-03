(function () {
  'use strict';

  const MEALS = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'dinner', label: 'Dinner' },
    { key: 'snack', label: 'Snack' },
  ];
  const MEAL_ORDER = Object.fromEntries(MEALS.map((m, i) => [m.key, i]));

  const $ = (sel) => document.querySelector(sel);
  const el = (id) => document.getElementById(id);

  // ---------- Dates (always local "YYYY-MM-DD" strings) ----------

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const weekStart = (s) => addDays(s, -parse(s).getDay());
  const fmt = (s, opts) => parse(s).toLocaleDateString(undefined, opts);

  // ---------- Data layer ----------

  const cfg = window.FOOD_LOG_CONFIG || {};
  const DEMO = !cfg.supabaseUrl || !cfg.supabaseKey;

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
  }

  function sortEntries(list) {
    return list.sort((a, b) =>
      MEAL_ORDER[a.meal] - MEAL_ORDER[b.meal] || a.position - b.position ||
      String(a.created_at).localeCompare(String(b.created_at)));
  }

  function uniqueNames(rows) {
    // rows newest first; keep the most recent spelling of each name
    const seen = new Set(); const out = [];
    for (const r of rows) {
      const k = r.name.trim().toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(r.name.trim()); }
    }
    return out;
  }

  const localApi = (() => {
    const KEY = 'foodlog-demo';
    const load = () => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* fall through to seed */ }
      const t = today(), y = addDays(t, -1);
      const seed = { entries: [], notes: {} };
      const add = (day, meal, name, position) => seed.entries.push({
        id: uuid(), day, meal, name, position, created_at: new Date().toISOString(),
      });
      add(t, 'breakfast', 'Breakfast burrito with sausage and potatoes', 0);
      add(t, 'breakfast', 'Black coffee', 1);
      add(t, 'lunch', 'Turkey sandwich', 0);
      add(t, 'snack', 'Apple', 0);
      add(y, 'breakfast', 'Oatmeal with blueberries', 0);
      add(y, 'lunch', 'Turkey chili', 0);
      add(y, 'dinner', 'Grilled salmon with rice', 0);
      seed.notes[y] = 'Slept badly, skipped workout';
      return seed;
    };
    let db = load();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
    save();
    const clone = (x) => JSON.parse(JSON.stringify(x));
    return {
      async session() { return { user: { id: 'demo' } }; },
      async signIn() {}, async signOut() {},
      onAuthChange() {},
      async listDay(day) { return sortEntries(clone(db.entries.filter((e) => e.day === day))); },
      async addEntry(row) {
        const e = { id: uuid(), created_at: new Date().toISOString(), ...row };
        db.entries.push(e); save(); return clone(e);
      },
      async updateEntry(id, patch) {
        const e = db.entries.find((x) => x.id === id); if (e) Object.assign(e, patch); save();
      },
      async deleteEntry(id) { db.entries = db.entries.filter((x) => x.id !== id); save(); },
      async restoreEntry(row) { db.entries.push(clone(row)); save(); },
      async saveOrder(changes) {
        for (const c of changes) {
          const e = db.entries.find((x) => x.id === c.id); if (e) { e.meal = c.meal; e.position = c.position; }
        }
        save();
      },
      async markedDays(from, to) {
        return new Set(db.entries.filter((e) => e.day >= from && e.day <= to).map((e) => e.day));
      },
      async foodNames() {
        return uniqueNames([...db.entries].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
      },
      async getNote(day) { return db.notes[day] || ''; },
      async saveNote(day, note) { if (note) db.notes[day] = note; else delete db.notes[day]; save(); },
      async exportData(from, to) {
        const inRange = (d) => (!from || d >= from) && (!to || d <= to);
        return {
          entries: clone(db.entries.filter((e) => inRange(e.day))),
          notes: Object.entries(db.notes).filter(([d]) => inRange(d)).map(([day, note]) => ({ day, note })),
        };
      },
    };
  })();

  const remoteApi = (() => {
    if (DEMO) return null;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    let userId = null;
    const check = ({ data, error }) => { if (error) throw error; return data; };

    // Supabase returns at most 1000 rows per request, so page through big queries.
    async function fetchAll(build) {
      const out = []; const size = 1000;
      for (let from = 0; ; from += size) {
        const rows = check(await build().range(from, from + size - 1));
        out.push(...rows);
        if (rows.length < size) return out;
      }
    }

    return {
      async session() {
        const { data } = await sb.auth.getSession();
        userId = data.session ? data.session.user.id : null;
        return data.session;
      },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        userId = data.user.id;
      },
      async signOut() { await sb.auth.signOut(); userId = null; },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event, session) => {
          userId = session ? session.user.id : null;
          cb(event, session);
        });
      },
      async listDay(day) {
        return sortEntries(check(await sb.from('entries').select('*').eq('day', day)));
      },
      async addEntry(row) {
        return check(await sb.from('entries').insert(row).select().single());
      },
      async updateEntry(id, patch) { check(await sb.from('entries').update(patch).eq('id', id)); },
      async deleteEntry(id) { check(await sb.from('entries').delete().eq('id', id)); },
      async restoreEntry(row) {
        const { id, day, meal, name, position, created_at } = row;
        check(await sb.from('entries').insert({ id, day, meal, name, position, created_at }));
      },
      async saveOrder(changes) {
        const results = await Promise.all(changes.map((c) =>
          sb.from('entries').update({ meal: c.meal, position: c.position }).eq('id', c.id)));
        results.forEach(check);
      },
      async markedDays(from, to) {
        const rows = await fetchAll(() => sb.from('entries').select('day').gte('day', from).lte('day', to));
        return new Set(rows.map((r) => r.day));
      },
      async foodNames() {
        const rows = check(await sb.from('entries').select('name, created_at')
          .order('created_at', { ascending: false }).limit(1000));
        return uniqueNames(rows);
      },
      async getNote(day) {
        const row = check(await sb.from('day_notes').select('note').eq('day', day).maybeSingle());
        return row ? row.note : '';
      },
      async saveNote(day, note) {
        check(await sb.from('day_notes').upsert({
          user_id: userId, day, note, updated_at: new Date().toISOString(),
        }));
      },
      async exportData(from, to) {
        const ranged = (q) => { if (from) q = q.gte('day', from); if (to) q = q.lte('day', to); return q; };
        const [entries, notes] = await Promise.all([
          fetchAll(() => ranged(sb.from('entries').select('day, meal, name, position, created_at')).order('day').order('id')),
          fetchAll(() => ranged(sb.from('day_notes').select('day, note')).order('day')),
        ]);
        return { entries, notes };
      },
    };
  })();

  const api = DEMO ? localApi : remoteApi;

  // ---------- State ----------

  const state = {
    day: today(),
    calMonth: null,      // first day of the month shown in the calendar, as a Date
    entries: [],
    marked: new Set(),   // days known to have entries
    names: [],           // past food names for suggestions
    sheet: null,         // { mode: 'add'|'edit', meal, entry }
    loadToken: 0,
  };

  // ---------- Toast ----------

  let toastTimer = null;
  function toast(text, undo) {
    el('toastText').textContent = text;
    const btn = el('toastUndo');
    btn.hidden = !undo;
    btn.onclick = undo ? () => { hideToast(); undo(); } : null;
    el('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 5000 : 3000);
  }
  function hideToast() { el('toast').hidden = true; }
  function fail(err) {
    console.error(err);
    toast("Couldn't save. Check your connection and try again.");
  }

  // ---------- Theme ----------

  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  function themePref() { try { return localStorage.getItem('foodlog-theme') || 'system'; } catch (e) { return 'system'; } }
  function applyTheme() {
    const pref = themePref();
    const dark = pref === 'dark' || (pref === 'system' && themeMedia.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#121120' : '#F3F2FA');
    document.querySelectorAll('#themeSeg button').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.themePref === pref)));
  }
  themeMedia.addEventListener('change', applyTheme);
  el('themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try { localStorage.setItem('foodlog-theme', b.dataset.themePref); } catch (err) {}
    applyTheme();
  });

  // ---------- Week strip ----------

  async function renderWeek() {
    const start = weekStart(state.day), t = today();
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    el('weekDays').innerHTML = days.map((d) => {
      const cls = ['wk-day', d === state.day && 'sel', d === t && 'today', state.marked.has(d) && 'has']
        .filter(Boolean).join(' ');
      return `<button class="${cls}" data-day="${d}" ${d > t ? 'disabled' : ''}
        aria-label="${fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}"
        ${d === state.day ? 'aria-current="date"' : ''}>
        <span class="wk-dow">${fmt(d, { weekday: 'short' })}</span>
        <span class="wk-num">${parse(d).getDate()}</span></button>`;
    }).join('');
    el('nextWeek').disabled = addDays(start, 7) > t;
    el('monthLabel').textContent = fmt(state.day, { month: 'long', year: 'numeric' });
  }

  async function refreshMarks(from, to) {
    try {
      const set = await api.markedDays(from, to);
      for (let d = from; d <= to; d = addDays(d, 1)) state.marked.delete(d);
      set.forEach((d) => state.marked.add(d));
    } catch (e) { console.error(e); }
  }

  el('weekDays').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-day]');
    if (b && !b.disabled) selectDay(b.dataset.day);
  });
  el('prevWeek').addEventListener('click', () => selectDay(addDays(state.day, -7)));
  el('nextWeek').addEventListener('click', () => {
    const next = addDays(state.day, 7);
    selectDay(next > today() ? today() : next);
  });

  // Swipe the week strip to change weeks.
  (function () {
    let x0 = null, y0 = null;
    const strip = $('.week');
    strip.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    strip.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0) el('prevWeek').click(); else if (!el('nextWeek').disabled) el('nextWeek').click();
    });
  })();

  // ---------- Calendar dropdown ----------

  function openPanel(name) {
    const cal = name === 'calendar', menu = name === 'menu';
    el('calendar').hidden = !cal;
    el('menu').hidden = !menu;
    el('monthBtn').setAttribute('aria-expanded', String(cal));
    el('menuBtn').setAttribute('aria-expanded', String(menu));
    if (cal) {
      const d = parse(state.day);
      state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCalendar();
    }
  }
  const closePanels = () => openPanel(null);

  async function renderCalendar(fetchMarks = true) {
    const m = state.calMonth, t = today();
    const first = iso(m);
    const last = iso(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    el('calLabel').textContent = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const now = new Date();
    el('calNext').disabled = m.getFullYear() > now.getFullYear() ||
      (m.getFullYear() === now.getFullYear() && m.getMonth() >= now.getMonth());

    let html = '<span></span>'.repeat(m.getDay());
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const cls = ['cal-day', d === state.day && 'sel', d === t && 'today', state.marked.has(d) && 'has']
        .filter(Boolean).join(' ');
      html += `<button class="${cls}" data-day="${d}" ${d > t ? 'disabled' : ''}
        aria-label="${fmt(d, { month: 'long', day: 'numeric' })}">${parse(d).getDate()}</button>`;
    }
    el('calGrid').innerHTML = html;

    if (fetchMarks) {
      const shown = state.calMonth;
      await refreshMarks(first, last);
      if (shown === state.calMonth && !el('calendar').hidden) renderCalendar(false);
    }
  }

  el('monthBtn').addEventListener('click', () => openPanel(el('calendar').hidden ? 'calendar' : null));
  el('menuBtn').addEventListener('click', () => openPanel(el('menu').hidden ? 'menu' : null));
  el('calPrev').addEventListener('click', () => {
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  el('calNext').addEventListener('click', () => {
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  el('calGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-day]');
    if (b && !b.disabled) { closePanels(); selectDay(b.dataset.day); }
  });
  el('calToday').addEventListener('click', () => { closePanels(); selectDay(today()); });

  // Close dropdowns when tapping elsewhere.
  document.addEventListener('click', (e) => {
    if (el('calendar').hidden && el('menu').hidden) return;
    if (e.target.closest('#calendar, #menu, #monthBtn, #menuBtn')) return;
    closePanels();
  });

  // ---------- Day view ----------

  async function selectDay(day) {
    if (day > today()) day = today();
    await flushNote();
    state.day = day;
    renderHeader();
    renderWeek();
    await loadDay();
  }

  function renderHeader() {
    const isToday = state.day === today();
    el('dayTitle').textContent = fmt(state.day, { weekday: 'long', month: 'long', day: 'numeric' });
    el('todayBadge').hidden = !isToday;
    el('todayBtn').hidden = isToday;
  }
  el('todayBtn').addEventListener('click', () => selectDay(today()));

  async function loadDay() {
    const token = ++state.loadToken;
    const day = state.day;
    try {
      const [entries, note] = await Promise.all([api.listDay(day), api.getNote(day)]);
      if (token !== state.loadToken) return;
      state.entries = entries;
      setNote(note);
      renderMeals();
    } catch (e) {
      if (token === state.loadToken) fail(e);
    }
    const ws = weekStart(day);
    await refreshMarks(ws, addDays(ws, 6));
    if (token === state.loadToken) renderWeek();
  }

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const svg = (id, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  let sortables = [];
  function renderMeals() {
    sortables.forEach((s) => s.destroy());
    el('meals').innerHTML = MEALS.map((m) => {
      const items = state.entries.filter((e) => e.meal === m.key).map((e) =>
        `<li class="entry" data-id="${e.id}"><div class="swipe-bg">${svg('trash')}</div>` +
        `<div class="entry-row"><span class="entry-name">${escapeHtml(e.name)}</span>` +
        `<button class="entry-del" aria-label="Delete ${escapeHtml(e.name)}">${svg('trash')}</button>` +
        `<span class="handle" aria-label="Drag to reorder">${svg('grip')}</span></div></li>`).join('');
      return `<section class="meal card" data-meal="${m.key}">
        <div class="meal-head"><h3>${m.label}</h3>
          <button class="add-btn" data-add="${m.key}" aria-label="Add to ${m.label.toLowerCase()}">${svg('plus')}</button>
        </div><ul class="entries" data-meal="${m.key}">${items}</ul><p class="empty">Nothing logged</p></section>`;
    }).join('');

    el('meals').querySelectorAll('.entry').forEach(attachSwipe);
    sortables = [...el('meals').querySelectorAll('.entries')].map((ul) => Sortable.create(ul, {
      group: 'meals',
      handle: '.handle',
      animation: 150,
      forceFallback: true,       // pointer-based dragging behaves the same on phones and desktop
      fallbackOnBody: true,
      emptyInsertThreshold: 24,  // makes it easy to drop into a meal with no entries
      onEnd: saveOrderFromDom,
    }));
  }

  async function saveOrderFromDom() {
    const changes = [];
    el('meals').querySelectorAll('.entries').forEach((ul) => {
      [...ul.children].forEach((li, position) => {
        const e = state.entries.find((x) => x.id === li.dataset.id);
        const meal = ul.dataset.meal;
        if (e && (e.meal !== meal || e.position !== position)) {
          e.meal = meal; e.position = position;
          changes.push({ id: e.id, meal, position });
        }
      });
    });
    sortEntries(state.entries);
    if (!changes.length) return;
    try { await api.saveOrder(changes); } catch (e) { fail(e); loadDay(); }
  }

  el('meals').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return openSheet({ mode: 'add', meal: add.dataset.add });
    const li = e.target.closest('.entry');
    if (!li) return;
    const entry = state.entries.find((x) => x.id === li.dataset.id);
    if (!entry) return;
    if (e.target.closest('.entry-del')) return removeEntry(entry);
    if (e.target.closest('.handle') || li.dataset.swiped) return;
    openSheet({ mode: 'edit', meal: entry.meal, entry });
  });

  // Swipe left on an entry to delete it (touch devices).
  function attachSwipe(li) {
    const row = li.querySelector('.entry-row');
    let x0 = 0, y0 = 0, dx = 0, tracking = false, swiping = false;
    row.addEventListener('touchstart', (e) => {
      if (e.target.closest('.handle')) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
      dx = 0; tracking = true; swiping = false;
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!swiping) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { tracking = false; return; }
        if (Math.abs(mx) < 10) return;
        swiping = true; row.style.transition = 'none'; li.classList.add('swiping');
      }
      dx = Math.min(0, mx);
      row.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!swiping) return;
      row.style.transition = '';
      li.dataset.swiped = '1';
      setTimeout(() => { delete li.dataset.swiped; }, 350);
      if (dx < -Math.min(120, row.offsetWidth * 0.35)) {
        row.style.transform = 'translateX(-100%)';
        const entry = state.entries.find((x) => x.id === li.dataset.id);
        setTimeout(() => entry && removeEntry(entry), 180);
      } else {
        row.style.transform = '';
        setTimeout(() => li.classList.remove('swiping'), 200);
      }
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', end);
  }

  async function removeEntry(entry) {
    const day = state.day;
    state.entries = state.entries.filter((x) => x.id !== entry.id);
    renderMeals();
    if (!state.entries.length) { state.marked.delete(day); renderWeek(); }
    try {
      await api.deleteEntry(entry.id);
    } catch (e) { fail(e); return loadDay(); }
    const short = entry.name.length > 28 ? entry.name.slice(0, 27) + '…' : entry.name;
    toast(`Deleted “${short}”`, async () => {
      try {
        await api.restoreEntry(entry);
        state.marked.add(day);
        if (state.day === day) await loadDay(); else renderWeek();
      } catch (e) { fail(e); }
    });
  }

  // ---------- Day notes ----------

  let noteTimer = null, noteDirty = false, noteDay = null;
  const noteEl = el('note');
  function autosize() { noteEl.style.height = 'auto'; noteEl.style.height = noteEl.scrollHeight + 'px'; }
  function setNote(text) {
    noteEl.value = text; noteDay = state.day; noteDirty = false;
    el('noteStatus').textContent = '';
    autosize();
  }
  noteEl.addEventListener('input', () => {
    autosize();
    noteDirty = true;
    el('noteStatus').textContent = '';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNote, 700);
  });
  noteEl.addEventListener('blur', flushNote);
  async function flushNote() {
    clearTimeout(noteTimer);
    if (!noteDirty || !noteDay) return;
    noteDirty = false;
    const day = noteDay, text = noteEl.value.trim();
    try {
      await api.saveNote(day, text);
      if (noteDay === day) el('noteStatus').textContent = 'Saved';
    } catch (e) { noteDirty = true; fail(e); }
  }
  window.addEventListener('pagehide', flushNote);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushNote(); });

  // ---------- Add / edit sheet ----------

  const input = el('foodInput');

  function setSheetMeal(meal) {
    state.sheet.meal = meal;
    el('mealPills').querySelectorAll('.pill').forEach((p) => {
      const on = p.dataset.meal === meal;
      p.classList.toggle('on', on);
      p.setAttribute('aria-checked', String(on));
    });
  }

  function openSheet({ mode, meal, entry }) {
    closePanels();
    state.sheet = { mode, meal, entry };
    el('sheetTitle').textContent = mode === 'add' ? 'Add food' : 'Edit food';
    el('sheetDate').textContent = fmt(state.day, { weekday: 'short', month: 'short', day: 'numeric' });
    el('sheetSubmit').textContent = mode === 'add' ? 'Add' : 'Save';
    el('sheetDelete').hidden = mode !== 'edit';
    el('sheetError').hidden = true;
    input.value = entry ? entry.name : '';
    setSheetMeal(meal);
    renderSuggestions();
    el('sheet').hidden = false;
    // Focusing right away opens the keyboard on phones in the same tap.
    input.focus();
    if (entry) input.setSelectionRange(input.value.length, input.value.length);
    if (!state.names.length) api.foodNames().then((n) => { state.names = n; renderSuggestions(); }).catch(console.error);
  }

  function closeSheet() { el('sheet').hidden = true; state.sheet = null; }

  function renderSuggestions() {
    const q = input.value.trim().toLowerCase();
    const list = el('suggestions');
    if (!q) { list.innerHTML = ''; return; }
    const matches = state.names
      .filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q)
      .sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q)))
      .slice(0, 5);
    list.innerHTML = matches.map((n) => {
      const i = n.toLowerCase().indexOf(q);
      const label = escapeHtml(n.slice(0, i)) + '<mark>' + escapeHtml(n.slice(i, i + q.length)) + '</mark>' + escapeHtml(n.slice(i + q.length));
      return `<li><button type="button" data-name="${escapeHtml(n)}">${svg('history')}<span>${label}</span></button></li>`;
    }).join('');
  }

  input.addEventListener('input', () => { el('sheetError').hidden = true; renderSuggestions(); });
  el('suggestions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-name]'); if (!b) return;
    input.value = b.dataset.name;
    renderSuggestions();
    input.focus();
  });
  el('mealPills').addEventListener('click', (e) => {
    const p = e.target.closest('[data-meal]'); if (p) setSheetMeal(p.dataset.meal);
  });
  el('sheetClose').addEventListener('click', closeSheet);
  el('sheet').addEventListener('click', (e) => { if (e.target === el('sheet')) closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('sheet').hidden) closeSheet(); else closePanels();
  });

  el('sheetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      el('sheetError').textContent = 'Enter a food first.';
      el('sheetError').hidden = false;
      input.focus();
      return;
    }
    const { mode, meal, entry } = state.sheet;
    const btn = el('sheetSubmit'); btn.disabled = true;
    try {
      if (mode === 'add') {
        const position = state.entries.filter((x) => x.meal === meal)
          .reduce((max, x) => Math.max(max, x.position + 1), 0);
        const row = await api.addEntry({ day: state.day, meal, name, position });
        state.entries.push(row);
        state.marked.add(state.day);
      } else {
        const patch = { name };
        if (meal !== entry.meal) {
          patch.meal = meal;
          patch.position = state.entries.filter((x) => x.meal === meal)
            .reduce((max, x) => Math.max(max, x.position + 1), 0);
        }
        await api.updateEntry(entry.id, patch);
        Object.assign(entry, patch);
      }
      sortEntries(state.entries);
      if (!state.names.some((n) => n.toLowerCase() === name.toLowerCase())) state.names.unshift(name);
      closeSheet();
      renderMeals();
      renderWeek();
    } catch (err) {
      fail(err);
    } finally {
      btn.disabled = false;
    }
  });

  el('sheetDelete').addEventListener('click', () => {
    const { entry } = state.sheet;
    closeSheet();
    removeEntry(entry);
  });

  // ---------- Export ----------

  function setExportRange(range) {
    el('exportSeg').querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.range === range)));
    el('exportRange').hidden = range !== 'range';
  }
  el('exportSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) setExportRange(b.dataset.range);
  });

  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;   // keep spreadsheets from running it as a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  el('exportBtn').addEventListener('click', async () => {
    const ranged = !el('exportRange').hidden;
    let from = ranged ? el('exportFrom').value : '';
    let to = ranged ? el('exportTo').value : '';
    if (ranged && from && to && from > to) [from, to] = [to, from];
    const btn = el('exportBtn'); btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const { entries, notes } = await api.exportData(from || null, to || null);
      const label = Object.fromEntries(MEALS.map((m) => [m.key, m.label]));
      const rows = sortEntries(entries).sort((a, b) => a.day.localeCompare(b.day)
        || MEAL_ORDER[a.meal] - MEAL_ORDER[b.meal] || a.position - b.position)
        .map((e) => [e.day, label[e.meal], e.name]);
      notes.filter((n) => n.note).forEach((n) => rows.push([n.day, 'Day note', n.note]));
      rows.sort((a, b) => a[0].localeCompare(b[0]));   // stable: notes stay after that day's food
      const csv = [['Date', 'Meal', 'Food'], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ranged && (from || to)
        ? `food-log_${from || 'start'}_to_${to || today()}.csv`
        : `food-log_all_${today()}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(rows.length ? `Exported ${entries.length} entries` : 'Nothing to export in that range');
    } catch (e) {
      console.error(e);
      toast("Couldn't export. Try again.");
    } finally {
      btn.disabled = false; btn.textContent = 'Download';
    }
  });

  // ---------- Auth and startup ----------

  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('loginBtn'), err = el('loginError');
    btn.disabled = true; btn.textContent = 'Signing in…'; err.hidden = true;
    try {
      await api.signIn(el('loginEmail').value.trim(), el('loginPassword').value);
      el('loginPassword').value = '';
      showApp();
    } catch (ex) {
      err.textContent = /invalid/i.test(ex.message || '')
        ? "That email and password don't match. Try again."
        : "Couldn't sign in. Check your connection and try again.";
      err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  el('signOutBtn').addEventListener('click', async () => {
    await flushNote();
    await api.signOut();
    showLogin();
  });

  function showLogin() {
    closePanels(); closeSheet();
    el('app').hidden = true;
    el('login').hidden = false;
  }

  let started = false;
  function showApp() {
    el('login').hidden = true;
    el('app').hidden = false;
    if (started) return;
    started = true;
    selectDay(today());
    api.foodNames().then((n) => { state.names = n; }).catch(console.error);
  }

  // When the app comes back to the foreground on a new day, jump to today
  // if you were looking at "today" before.
  let lastToday = today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || el('app').hidden) return;
    const t = today();
    if (t !== lastToday) {
      const wasToday = state.day === lastToday;
      lastToday = t;
      if (wasToday) selectDay(t); else renderWeek();
    }
  });

  async function start() {
    applyTheme();
    setExportRange('all');
    el('exportTo').max = el('exportFrom').max = today();
    el('signOutBtn').hidden = DEMO;
    el('demoNote').hidden = !DEMO;
    api.onAuthChange((event) => { if (event === 'SIGNED_OUT') showLogin(); });
    let session = null;
    try { session = await api.session(); } catch (e) { console.error(e); }
    if (session) showApp(); else showLogin();
  }

  start();
})();
