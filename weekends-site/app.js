(function () {
  const CFG = window.WEEKENDS_CONFIG || {};
  const IS_EXT = !!(window.chrome && chrome.identity && chrome.identity.getAuthToken);
  // sample data when opened as a local file with no Google setup, or with ?demo
  const MOCK = /[?&]demo\b/.test(location.search) || (!IS_EXT && !CFG.webClientId);
  const isMobile = () => matchMedia('(max-width: 760px)').matches;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_MS = 86400000;
  const api = (fn, ...args) => (MOCK ? Mock : window.CalendarAPI)[fn](...args);

  // ---------- date helpers (local, noon-anchored to dodge DST) ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dayStart = s => { const d = parse(s); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dow = s => parse(s).getDay();
  const shortDate = s => { const d = parse(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); };
  const today = () => ymd(new Date());
  const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(/\s/g, '').toLowerCase();
  const timeVal = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  function weekends(year) {
    const d = new Date(year, 0, 1, 12);
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    const out = [];
    while (d.getFullYear() === year) { const sat = ymd(d); out.push({ sat, sun: addDays(sat, 1) }); d.setDate(d.getDate() + 7); }
    return out;
  }

  function holidays(year) {
    const nth = (m, wd, n) => { const d = new Date(year, m, 1, 12); while (d.getDay() !== wd) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return ymd(d); };
    const last = (m, wd) => { const d = new Date(year, m + 1, 0, 12); while (d.getDay() !== wd) d.setDate(d.getDate() - 1); return ymd(d); };
    const fix = (m, day) => ymd(new Date(year, m, day, 12));
    const tg = nth(10, 4, 4);
    return [
      [fix(0, 1), "New Year's Day"], [nth(0, 1, 3), 'MLK Day'], [nth(1, 1, 3), "Presidents' Day"],
      [last(4, 1), 'Memorial Day'], [fix(5, 19), 'Juneteenth'], [fix(6, 4), 'July 4th'],
      [nth(8, 1, 1), 'Labor Day'], [nth(9, 1, 2), "Indigenous Peoples' Day"], [fix(10, 11), 'Veterans Day'],
      [tg, 'Thanksgiving'], [addDays(tg, 1), 'Day after Thanksgiving'], [fix(11, 24), 'Christmas Eve'],
      [fix(11, 25), 'Christmas'], [fix(11, 31), "New Year's Eve"]
    ].map(([date, name]) => ({ date, name }));
  }

  // ---------- prefs ----------
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  // ---------- state ----------
  const S = {
    view: ['week', 'month'].includes(pref('view')) ? pref('view') : 'weekends',
    month: (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })(),
    year: new Date().getFullYear(),
    weekStartDay: pref('weekStartDay') !== null ? Number(pref('weekStartDay')) : 6,
    weekStart: null,
    calendars: [], selected: [], defaultCal: null, me: '', shared: null, failed: [],
    events: [], notes: {},
    hidePast: pref('hidePast') === '1',
    showFri: pref('showFri') !== '0'
  };
  const startOfWeek = s => addDays(s, -((dow(s) - S.weekStartDay + 7) % 7));
  S.weekStart = startOfWeek(today());

  const $ = id => document.getElementById(id);
  const panel = $('panel');
  const calById = id => S.calendars.find(c => c.id === id);
  function status(t, sticky) {
    $('status').textContent = t;
    if (!sticky) setTimeout(() => { if ($('status').textContent === t) $('status').textContent = ''; }, 2500);
  }

  // ---------- event helpers ----------
  const evStartDay = ev => ev.allDay ? ev.start : ymd(new Date(ev.startMs));
  const evEndDay = ev => ev.allDay ? addDays(ev.end, -1) : ymd(new Date(ev.endMs - 1)); // inclusive
  function covers(ev, day) {
    if (ev.allDay) return ev.start <= day && day < ev.end;
    const s = dayStart(day);
    return ev.startMs < s + DAY_MS && ev.endMs > s;
  }
  const isLong = ev => ev.allDay || (ev.endMs - ev.startMs >= DAY_MS) || evStartDay(ev) !== evEndDay(ev) && (ev.endMs - ev.startMs) > 12 * 3600000;
  const order = (x, y) => (y.allDay - x.allDay) || ((x.startMs || 0) - (y.startMs || 0)) || x.title.localeCompare(y.title);

  // sticker colours, one per calendar
  // sticker colours come from the active theme (--p1..--p6)
  const slot = calId => Math.max(0, S.calendars.findIndex(c => c.id === calId)) % 6 + 1;
  const paint = ev => { const n = slot(ev.calId); return `--c:var(--p${n});--fg:var(--p${n}f)`; };

  const THEMES = [
    { id: 'cafe', name: 'Cafe Robot', sw: ['#0000ff', '#e4b8ea', '#f85032', '#fff575'] },
    { id: 'paper', name: 'Paper', sw: ['#f3efe6', '#fffdf8', '#e4572e', '#9bc1bc'] },
    { id: 'night', name: 'Night', sw: ['#0b0b12', '#171724', '#ff5c8a', '#c6ff4a'] },
    { id: 'citrus', name: 'Citrus', sw: ['#ff6b35', '#ffe8c2', '#2ec4b6', '#ffd23f'] },
    { id: 'forest', name: 'Forest', sw: ['#1f3d2b', '#e9e4d0', '#d9663b', '#e9c46a'] },
    { id: 'daisy', name: 'Daisy', sw: ['#f4f3e8', '#d2fba4', '#e7ccff', '#f0b8e8'] }
  ];
  const setTheme = id => { document.documentElement.dataset.theme = id; pref('theme', id); };
  function tilt(ev) { let h = 0; for (const ch of String(ev.id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (((h % 5) + 5) % 5 - 2) * 0.6; }
  const evIndex = ev => S.events.indexOf(ev);
  const isRO = () => !!(S.shared && S.shared.ro);
  const canEdit = ev => { if (isRO()) return false; const c = calById(ev.calId); return !c || c.writable !== false; };

  // ---------- loading ----------
  async function load(scroll) {
    status('Loading…', true);
    try {
      let from, to;
      if (S.view === 'weekends') { from = ymd(new Date(S.year, 0, 1 - 3, 12)); to = ymd(new Date(S.year + 1, 0, 10, 12)); }
      else if (S.view === 'month') { [from, to] = monthRange(); }
      else { from = S.weekStart; to = addDays(S.weekStart, 7); }
      S.events = await api('getRange', from, to, S.selected);
      S.failed = S.events.failed || [];
      render();
      renderBanner();
      status('');
      if (scroll) scrollToNow();
    } catch (e) {
      status('');
      if (e && e.code === 'auth') return showSignIn();
      panel.innerHTML = `<div class="loading">Couldn’t load: ${esc(msg(e))}</div>`;
    }
  }

  // ---------- render ----------
  function render() {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    $('hidePastWrap').hidden = S.view !== 'weekends';
    $('showFriWrap').hidden = S.view !== 'weekends';
    $('showFri').checked = S.showFri;
    $('weekStartWrap').hidden = S.view === 'weekends';
    $('weekStart').value = String(S.weekStartDay);
    document.body.classList.toggle('mobile', isMobile());
    if (isMobile()) { if (S.view === 'weekends') renderWeekendsMobile(); else if (S.view === 'month') renderMonthMobile(); else renderWeekMobile(); }
    else if (S.view === 'weekends') renderWeekends(); else if (S.view === 'month') renderMonth(); else renderWeek();
    document.documentElement.style.setProperty('--header-h', $('hdr').offsetHeight + 'px');
  }

  // w = { fri, sat, sun }
  const rel = (d, anchor, back) => (back ? d < addDays(anchor, -6) : d > addDays(anchor, 6)) ? shortDate(d) : DOW[dow(d)];

  function chip(ev, w) {
    const sd = evStartDay(ev), ed = evEndDay(ev), bits = [];
    if (!ev.allDay) bits.push(fmtTime(ev.startMs));
    if (sd < w.first) bits.push('from ' + rel(sd, w.first, true));
    if (ed > w.sun) bits.push('to ' + rel(ed, w.sun, false));
    return `<button class="chip" data-i="${evIndex(ev)}" draggable="${canEdit(ev)}" style="${paint(ev)};--r:${tilt(ev)}deg" title="${esc(ev.title + (ev.location ? ' — ' + ev.location : ''))}"><span class="t">${esc(ev.title)}</span>${bits.length ? `<span class="m">${esc(bits.join(' · '))}</span>` : ''}</button>`;
  }

  function bar(p, w) {
    const { ev, s, e, lane } = p;
    const sd = evStartDay(ev), ed = evEndDay(ev);
    const cl = sd < w.first, cr = ed > w.sun;
    let range = '';
    if (cl || cr) range = (cl ? rel(sd, w.first, true) : DOW[dow(sd)]) + ' – ' + (cr ? rel(ed, w.sun, false) : DOW[dow(ed)]);
    else if (!ev.allDay) range = `${DOW[dow(sd)]} ${fmtTime(ev.startMs)} – ${DOW[dow(ed)]} ${fmtTime(ev.endMs)}`;
    return `<button class="bar${cl ? ' cl' : ''}${cr ? ' cr' : ''}" data-i="${evIndex(ev)}" draggable="${canEdit(ev)}" style="${paint(ev)};grid-column:${s + 1}/${e + 2};grid-row:${lane + 2}" title="${esc(ev.title)}">${cl ? '<span class="arr">←</span>' : ''}<span class="t">${esc(ev.title)}</span>${range ? `<span class="m">${esc(range)}</span>` : ''}${cr ? '<span class="arr">→</span>' : ''}</button>`;
  }

  function renderWeekends() {
    $('title').textContent = S.year;
    const ws = weekends(S.year), hols = holidays(S.year), t = today();
    const out = [`<div class="wk${S.showFri ? '' : ' nofri'}"><div class="head"><div class="h-month"></div>${S.showFri ? '<div class="h-fri">Friday</div>' : ''}<div>Saturday</div><div>Sunday</div><div class="h-hol">Holidays</div></div>`];
    let lastMonth = -1, free = 0, freeLeft = 0;
    ws.forEach(wk => {
      const w = { fri: addDays(wk.sat, -1), sat: wk.sat, sun: wk.sun }; w.first = S.showFri ? w.fri : w.sat;
      const days = S.showFri ? [w.fri, w.sat, w.sun] : [w.sat, w.sun], satI = days.indexOf(w.sat);
      const m = parse(w.sat).getMonth(), monthStart = m !== lastMonth; lastMonth = m;
      const past = w.sun < t, now = w.sun >= t && addDays(w.sat, -5) <= t;
      const singles = days.map(() => []), multi = [];
      for (const ev of S.events) {
        const hit = days.map(d => covers(ev, d));
        const s = hit.indexOf(true);
        if (s === -1) continue;
        const e = hit.lastIndexOf(true);
        if (s === e) singles[s].push(ev); else multi.push({ ev, s, e });
      }
      singles.forEach(l => l.sort(order));
      multi.sort((x, y) => x.s - y.s || (y.e - y.s) - (x.e - x.s) || order(x.ev, y.ev));
      const lanes = [];
      multi.forEach(p => { let l = lanes.findIndex(end => end < p.s); if (l === -1) { l = lanes.length; lanes.push(p.e); } else lanes[l] = p.e; p.lane = l; });
      const isFree = !singles.slice(satI).some(l => l.length) && !multi.some(p => p.e >= satI);
      if (isFree) { free++; if (!past) freeLeft++; }
      if (S.hidePast && past) return;
      const h = hols.filter(x => x.date >= addDays(w.sat, -2) && x.date <= addDays(w.sat, 2));
      const half = (i) => {
        const day = days[i], list = singles[i], newMonth = i > 0 && parse(day).getMonth() !== parse(days[i - 1]).getMonth();
        return `
        <div class="half${day === w.fri ? ' fri' : ''}" data-day="${day}" style="grid-column:${i + 1};grid-row:1/-1"></div>
        <div class="cell" style="grid-column:${i + 1};grid-row:1">
          <button class="daynum${newMonth ? ' newmonth' : ''}" data-goto="${day}" title="Open the week of ${shortDate(day)}">${parse(day).getDate()}</button>
          <div class="plans" data-for="${day}">${list.map(e => chip(e, w)).join('')}${list.length ? '' : '<span class="addhint">+ add</span>'}</div>
        </div>`;
      };
      out.push(`<div class="row${monthStart ? ' monthstart' : ''}${past ? ' past' : ''}${now ? ' now' : ''}" data-sat="${w.sat}">`,
        `<div class="month">${monthStart ? MONTHS[m] : ''}</div>`,
        `<div class="wkd" data-drop style="grid-template-rows:auto${' auto'.repeat(lanes.length)}${lanes.length ? ' 6px' : ''}">${days.map((_, i) => half(i)).join('')}${multi.map(p => bar(p, w)).join('')}</div>`,
        `<div class="hol">${h.map(x => `<span class="sticker">${esc(x.name)}${[0, 6].includes(dow(x.date)) ? '' : ` <small>${DOW[dow(x.date)]}</small>`}</span>`).join('')}</div>`,
        '</div>');
    });
    out.push('</div>');
    panel.innerHTML = out.join('');
    const n = S.year === new Date().getFullYear() ? freeLeft : free;
    $('stat').hidden = false;
    $('stat').textContent = `${n} free weekend${n === 1 ? '' : 's'}${S.year === new Date().getFullYear() ? ' left' : ''}`;
  }

  // ---------- month view ----------
  function monthRange() {
    const first = ymd(new Date(S.month.y, S.month.m, 1, 12)), last = ymd(new Date(S.month.y, S.month.m + 1, 0, 12));
    const start = startOfWeek(first), end = addDays(startOfWeek(last), 7);
    return [start, end];
  }

  function renderMonth() {
    $('stat').hidden = true;
    $('title').textContent = new Date(S.month.y, S.month.m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const [start, end] = monthRange(), t = today(), MAX = 4;
    const nWeeks = Math.round(daysBetween(start, end) / 7);
    const head = [...Array(7)].map((_, i) => { const d = addDays(start, i); return `<div class="${[0, 6].includes(dow(d)) ? 'weekend' : ''}">${DOW[dow(d)]}</div>`; }).join('');
    const rows = [];
    for (let w = 0; w < nWeeks; w++) {
      const days = [...Array(7)].map((_, i) => addDays(start, w * 7 + i));
      const items = [];
      for (const ev of S.events) {
        const sd = evStartDay(ev), ed = evEndDay(ev);
        if (ed < days[0] || sd > days[6]) continue;
        const s = sd < days[0] ? 0 : days.indexOf(sd), e = ed > days[6] ? 6 : days.indexOf(ed);
        if (s < 0 || e < 0) continue;
        items.push({ ev, s, e, multi: s !== e || isLong(ev) && sd !== ed });
      }
      items.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s) || b.multi - a.multi || order(a.ev, b.ev));
      const occ = []; // occ[lane][day]
      const hidden = Array(7).fill(0);
      items.forEach(it => {
        let lane = 0;
        while (occ[lane] && occ[lane].slice(it.s, it.e + 1).some(Boolean)) lane++;
        if (lane >= MAX) { for (let d = it.s; d <= it.e; d++) hidden[d]++; it.lane = -1; return; }
        occ[lane] = occ[lane] || Array(7).fill(false);
        for (let d = it.s; d <= it.e; d++) occ[lane][d] = true;
        it.lane = lane;
      });
      const lanes = Math.min(MAX, occ.length);
      const cells = days.map((d, i) => {
        const other = parse(d).getMonth() !== S.month.m, wknd = [0, 6].includes(dow(d));
        return `<div class="half${other ? ' other' : ''}${wknd ? ' weekend' : ''}${d === t ? ' istoday' : ''}" data-day="${d}" style="grid-column:${i + 1};grid-row:1/-1"></div>
          <div class="cell mcell" style="grid-column:${i + 1};grid-row:1">
            <button class="daynum${d === t ? ' todaynum' : ''}" data-goto="${d}" title="Open the week of ${shortDate(d)}">${parse(d).getDate()}</button>
            <div class="plans" data-for="${d}"></div>
          </div>`;
      }).join('');
      const evs = items.filter(it => it.lane >= 0).map(it => {
        const { ev, s, e, lane } = it, pos = `grid-column:${s + 1}/${e + 2};grid-row:${lane + 2}`;
        if (s !== e || it.multi) {
          const cl = evStartDay(ev) < days[0], cr = evEndDay(ev) > days[6];
          return `<button class="bar mbar${cl ? ' cl' : ''}${cr ? ' cr' : ''}" data-i="${evIndex(ev)}" draggable="${canEdit(ev)}" style="${paint(ev)};${pos}" title="${esc(ev.title)}">${cl ? '<span class="arr">←</span>' : ''}<span class="t">${esc(ev.title)}</span>${cr ? '<span class="arr">→</span>' : ''}</button>`;
        }
        return `<button class="chip mchip${ev.allDay ? '' : ' timed'}" data-i="${evIndex(ev)}" draggable="${canEdit(ev)}" style="${paint(ev)};${pos}" title="${esc(ev.title + (ev.location ? ' — ' + ev.location : ''))}">${ev.allDay ? '' : `<span class="m">${fmtTime(ev.startMs)}</span>`}<span class="t">${esc(ev.title)}</span></button>`;
      }).join('');
      const more = hidden.map((n, i) => n ? `<button class="more" data-goto="${days[i]}" style="grid-column:${i + 1};grid-row:${lanes + 2}">+${n} more</button>` : '').join('');
      rows.push(`<div class="mrow" data-drop style="grid-template-rows:34px repeat(${lanes}, auto) minmax(18px, 1fr)">${cells}${evs}${more}</div>`);
    }
    panel.innerHTML = `<div class="monthgrid"><div class="mh">${head}</div>${rows.join('')}</div>`;
  }

  // ---------- phone layouts ----------
  function holidayTags(w, hols) {
    return hols.filter(x => x.date >= addDays(w.sat, -2) && x.date <= addDays(w.sat, 2))
      .map(x => `<span class="htag">${esc(x.name)}${[0, 6].includes(dow(x.date)) ? '' : ` · ${DOW[dow(x.date)]}`}</span>`).join('');
  }

  function renderWeekendsMobile() {
    $('title').textContent = S.year;
    const ws = weekends(S.year), hols = holidays(S.year), t = today();
    let free = 0, freeLeft = 0;
    const cards = ws.map(wk => {
      const w = { fri: addDays(wk.sat, -1), sat: wk.sat, sun: wk.sun }; w.first = S.showFri ? w.fri : w.sat;
      const days = S.showFri ? [w.fri, w.sat, w.sun] : [w.sat, w.sun], satI = days.indexOf(w.sat);
      const past = w.sun < t, now = w.sun >= t && addDays(w.sat, -5) <= t;
      const singles = days.map(() => []), multi = [];
      for (const ev of S.events) {
        const hit = days.map(d => covers(ev, d)), s0 = hit.indexOf(true);
        if (s0 === -1) continue;
        const e0 = hit.lastIndexOf(true);
        if (s0 === e0) singles[s0].push(ev); else multi.push(ev);
      }
      singles.forEach(l => l.sort(order)); multi.sort(order);
      const isFree = !singles.slice(satI).some(l => l.length) && !multi.some(ev => covers(ev, w.sat) || covers(ev, w.sun));
      if (isFree) { free++; if (!past) freeLeft++; }
      if (S.hidePast && past) return '';
      const f = parse(w.first), su = parse(w.sun);
      const range = f.getMonth() === su.getMonth() ? `${MONTHS[f.getMonth()]} ${f.getDate()}–${su.getDate()}` : `${shortDate(w.first)} – ${shortDate(w.sun)}`;
      const bars = multi.map(ev => {
        const sd = evStartDay(ev), ed = evEndDay(ev);
        const lbl = `${sd < w.first ? rel(sd, w.first, true) : DOW[dow(sd)]} – ${ed > w.sun ? rel(ed, w.sun, false) : DOW[dow(ed)]}`;
        return `<button class="bar mb" data-i="${evIndex(ev)}" style="${paint(ev)}"><span class="t">${esc(ev.title)}</span><span class="m">${esc(lbl)}</span></button>`;
      }).join('');
      const dayRow = i => `<div class="wc-day half${days[i] === w.fri ? ' fri' : ''}" data-day="${days[i]}">
          <button class="daynum" data-goto="${days[i]}">${parse(days[i]).getDate()}</button>
          <span class="dname">${DOW[dow(days[i])]}</span>
          <div class="plans" data-for="${days[i]}">${singles[i].map(e => chip(e, w)).join('')}${singles[i].length ? '' : '<span class="addhint">+ add</span>'}</div>
        </div>`;
      return `<article class="wcard${past ? ' past' : ''}${now ? ' now' : ''}${isFree ? ' free' : ''}" data-sat="${w.sat}">
        <header><b>${range}</b>${isFree && !past ? '<span class="freetag">free</span>' : ''}${holidayTags(w, hols)}</header>
        ${bars ? `<div class="wc-bars">${bars}</div>` : ''}
        ${days.map((_, i) => dayRow(i)).join('')}
      </article>`;
    }).join('');
    panel.innerHTML = `<div class="wcards">${cards}</div>`;
    const n = S.year === new Date().getFullYear() ? freeLeft : free;
    $('stat').hidden = false;
    $('stat').textContent = `${n} free${S.year === new Date().getFullYear() ? ' left' : ''}`;
  }

  function agendaItem(ev, day) {
    const sd = evStartDay(ev), ed = evEndDay(ev);
    let when = ev.allDay ? (sd !== ed ? `${shortDate(sd)} – ${shortDate(ed)}` : 'All day') : `${fmtTime(ev.startMs)} – ${fmtTime(ev.endMs)}`;
    return `<button class="agitem" data-i="${evIndex(ev)}"><i style="background:var(--p${slot(ev.calId)})"></i><span class="t">${esc(ev.title)}</span><span class="m">${esc(when)}</span></button>`;
  }
  const dayEvents = d => S.events.filter(ev => covers(ev, d)).sort(order);

  function renderMonthMobile() {
    $('stat').hidden = true;
    $('title').textContent = new Date(S.month.y, S.month.m, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const [start, end] = monthRange(), t = today();
    const inMonth = d => parse(d).getMonth() === S.month.m;
    if (!S.selDay || !inMonth(S.selDay)) S.selDay = inMonth(t) ? t : ymd(new Date(S.month.y, S.month.m, 1, 12));
    const n = daysBetween(start, end);
    const head = [...Array(7)].map((_, i) => `<div>${DOW[dow(addDays(start, i))].slice(0, 2)}</div>`).join('');
    const cells = [...Array(n)].map((_, i) => {
      const d = addDays(start, i), evs = dayEvents(d);
      const dots = evs.slice(0, 4).map(ev => `<i style="background:var(--p${slot(ev.calId)})"></i>`).join('');
      return `<button class="mday${inMonth(d) ? '' : ' other'}${d === t ? ' istoday' : ''}${d === S.selDay ? ' sel' : ''}${[0, 6].includes(dow(d)) ? ' weekend' : ''}" data-sel="${d}"><span>${parse(d).getDate()}</span><span class="dots">${dots}</span></button>`;
    }).join('');
    const evs = dayEvents(S.selDay);
    panel.innerHTML = `<div class="mmini"><div class="mmh">${head}</div><div class="mmg">${cells}</div></div>
      <div class="agenda"><div class="aghead"><b>${DOW[dow(S.selDay)]}, ${shortDate(S.selDay)}</b>${isRO() ? '' : `<button class="pill small" data-add="${S.selDay}">+ Add</button>`}</div>
      ${evs.length ? evs.map(ev => agendaItem(ev, S.selDay)).join('') : '<div class="agempty">Nothing planned</div>'}</div>`;
  }

  function renderWeekMobile() {
    $('stat').hidden = true;
    const days = [...Array(7)].map((_, i) => addDays(S.weekStart, i)), t = today();
    $('title').textContent = `${shortDate(days[0])} – ${parse(days[6]).getMonth() === parse(days[0]).getMonth() ? parse(days[6]).getDate() : shortDate(days[6])}`;
    panel.innerHTML = `<div class="agenda week">${days.map(d => {
      const evs = dayEvents(d);
      return `<section class="agday${d === t ? ' istoday' : ''}${[0, 6].includes(dow(d)) ? ' weekend' : ''}">
        <div class="aghead"><b>${DOW[dow(d)]} <span>${parse(d).getDate()}</span></b>${isRO() ? '' : `<button class="addmini" data-add="${d}" aria-label="Add a plan on ${shortDate(d)}">+</button>`}</div>
        ${evs.length ? evs.map(ev => agendaItem(ev, d)).join('') : '<div class="agempty">—</div>'}
      </section>`;
    }).join('')}</div>`;
  }

  // ---------- ⋯ menu (phone) ----------
  function openMore() {
    $('moreHidePast').checked = S.hidePast;
    $('moreHidePastRow').hidden = S.view !== 'weekends';
    $('moreShowFriRow').hidden = S.view !== 'weekends';
    $('moreShowFri').checked = S.showFri;
    $('moreWeekStartRow').hidden = S.view === 'weekends';
    $('moreWeekStart').value = String(S.weekStartDay);
    $('moreScrim').classList.add('open');
  }
  const closeMore = () => $('moreScrim').classList.remove('open');
  $('moreBtn').addEventListener('click', openMore);
  $('moreScrim').addEventListener('mousedown', e => { if (e.target === $('moreScrim')) closeMore(); });
  $('moreList').addEventListener('click', e => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    closeMore();
    $(b.dataset.do).click();
  });
  $('moreShowFri').addEventListener('change', () => { $('showFri').checked = $('moreShowFri').checked; $('showFri').dispatchEvent(new Event('change')); });
  $('moreHidePast').addEventListener('change', () => { $('hidePast').checked = $('moreHidePast').checked; $('hidePast').dispatchEvent(new Event('change')); });
  $('moreWeekStart').addEventListener('change', () => { $('weekStart').value = $('moreWeekStart').value; $('weekStart').dispatchEvent(new Event('change')); });

  function renderWeek() {
    $('stat').hidden = true;
    const days = [...Array(7)].map((_, i) => addDays(S.weekStart, i));
    const first = parse(days[0]), last = parse(days[6]);
    $('title').textContent = first.getMonth() === last.getMonth()
      ? `${MONTHS[first.getMonth()]} ${first.getDate()} – ${last.getDate()}`
      : `${shortDate(days[0])} – ${shortDate(days[6])}`;
    const t = today(), isWknd = d => [0, 6].includes(dow(d));

    // all-day / multi-day lane packing
    const long = S.events.filter(isLong).filter(ev => evEndDay(ev) >= days[0] && evStartDay(ev) <= days[6]).sort((a, b) =>
      (evStartDay(a) < evStartDay(b) ? -1 : evStartDay(a) > evStartDay(b) ? 1 : 0) || (evEndDay(b) > evEndDay(a) ? 1 : -1));
    const lanes = [];
    const placed = long.map(ev => {
      const s = Math.max(0, days.indexOf(evStartDay(ev)) === -1 ? 0 : days.indexOf(evStartDay(ev)));
      const e = evEndDay(ev) > days[6] ? 6 : days.indexOf(evEndDay(ev));
      let lane = lanes.findIndex(end => end < s);
      if (lane === -1) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
      return { ev, s, e, lane, cl: evStartDay(ev) < days[0], cr: evEndDay(ev) > days[6] };
    });
    const nl = lanes.length;

    const head = `<div class="wh"><div></div>${days.map(d => `<div class="${isWknd(d) ? 'weekend' : ''}${d === t ? ' today' : ''}">${DOW[dow(d)]}<span class="dn">${parse(d).getDate()}</span></div>`).join('')}</div>`;
    const allday = `<div class="allday" style="grid-template-rows:repeat(${nl}, auto) minmax(28px, auto)">
      <div style="grid-column:1;grid-row:1/-1">All day</div>
      ${days.map((d, i) => `<div class="adbg${isWknd(d) ? ' weekend' : ''}" data-day="${d}" style="grid-column:${i + 2};grid-row:1/-1"></div>`).join('')}
      ${placed.map(p => `<button class="bar wbar${p.cl ? ' cl' : ''}${p.cr ? ' cr' : ''}" data-i="${evIndex(p.ev)}" style="${paint(p.ev)};grid-column:${p.s + 2}/${p.e + 3};grid-row:${p.lane + 1}" title="${esc(p.ev.title)}">${p.cl ? '<span class="arr">←</span>' : ''}<span class="t">${esc(p.ev.title)}</span>${p.ev.allDay ? '' : `<span class="m">${fmtTime(p.ev.startMs)}</span>`}${p.cr ? '<span class="arr">→</span>' : ''}</button>`).join('')}
    </div>`;

    const cols = days.map(d => {
      const ds = dayStart(d);
      const segs = S.events.filter(ev => !isLong(ev) && covers(ev, d)).map(ev => ({
        ev, s: Math.max(ev.startMs, ds), e: Math.min(ev.endMs, ds + DAY_MS)
      })).sort((a, b) => a.s - b.s || b.e - a.e);
      // overlap columns
      let cluster = [], clusterEnd = 0;
      const flush = () => { const n = Math.max(...cluster.map(c => c.col)) + 1; cluster.forEach(c => c.n = n); cluster = []; };
      segs.forEach(seg => {
        if (cluster.length && seg.s >= clusterEnd) flush();
        const used = cluster.filter(c => c.e > seg.s).map(c => c.col);
        let col = 0; while (used.includes(col)) col++;
        seg.col = col; cluster.push(seg); clusterEnd = Math.max(clusterEnd, seg.e);
      });
      if (cluster.length) flush();
      const evs = segs.map(sg => {
        const top = (sg.s - ds) / 3600000, h = Math.max(.42, (sg.e - sg.s) / 3600000);
        return `<button class="ev" data-i="${evIndex(sg.ev)}" style="${paint(sg.ev)};top:calc(var(--hour) * ${top});height:calc(var(--hour) * ${h} - 2px);left:calc(${sg.col / sg.n * 100}% + 2px);width:calc(${100 / sg.n}% - 4px)"><b>${esc(sg.ev.title)}</b><span>${fmtTime(sg.ev.startMs)} – ${fmtTime(sg.ev.endMs)}</span></button>`;
      }).join('');
      const nowLine = d === t ? `<div class="nowline" style="top:calc(var(--hour) * ${(Date.now() - ds) / 3600000})"></div>` : '';
      return `<div class="col${isWknd(d) ? ' weekend' : ''}" data-day="${d}">${evs}${nowLine}</div>`;
    }).join('');
    const hours = [...Array(24)].map((_, h) => `<div><span>${h === 0 ? '' : (h % 12 || 12) + (h < 12 ? 'am' : 'pm')}</span></div>`).join('');

    panel.innerHTML = `<div class="weekwrap"><div class="weekgrid">${head}${allday}<div class="scroller" id="scroller"><div class="timegrid"><div class="hours">${hours}</div>${cols}</div></div></div></div>`;
    const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 48;
    const sc = $('scroller');
    sc.scrollTop = days.includes(t) ? Math.max(0, (new Date().getHours() - 2) * hourPx) : 8 * hourPx;
  }

  function scrollToNow() {
    if (S.view !== 'weekends') return;
    const t = today();
    const card = [...panel.querySelectorAll('.wcard')].find(r => addDays(r.dataset.sat, 1) >= t);
    if (card) { window.scrollTo({ top: card.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' }); return; }
    const row = [...panel.querySelectorAll('.row')].find(r => addDays(r.dataset.sat, 1) >= t);
    if (row) { const cell = row.querySelector('.month'); window.scrollTo({ top: cell.getBoundingClientRect().top + scrollY - 140, behavior: 'smooth' }); }
  }

  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(parseFloat(getComputedStyle(t).minHeight) || 0, t.scrollHeight) + 'px'; }

  // ---------- quick add (type straight into a Sat/Sun cell) ----------
  function startQuick(day) {
    if (isRO()) return;
    const plans = panel.querySelector(`.plans[data-for="${day}"]`);
    if (!plans) return;
    const existing = plans.querySelector('.quick');
    if (existing) { existing.focus(); return; }
    panel.querySelectorAll('.quickrow').forEach(q => q.remove());
    const hint = plans.querySelector('.addhint'); if (hint) hint.hidden = true;
    const row = document.createElement('div');
    row.className = 'quickrow';
    row.innerHTML = `<input class="quick" placeholder="Add a plan for ${DOW[dow(day)]} ${parse(day).getDate()}…" aria-label="New plan"><button type="button" class="more">details</button>`;
    plans.appendChild(row);
    const input = row.querySelector('input');
    let done = false;
    const cancel = () => { if (done) return; done = true; row.remove(); if (hint) hint.hidden = false; };
    const commit = async () => {
      const title = input.value.trim();
      if (!title) return cancel();
      if (done) return; done = true;
      input.disabled = true;
      status('Saving…', true);
      try {
        const saved = await api('saveEvent', { calId: S.defaultCal, title, allDay: true, startDate: day, endDate: day });
        if (S.selected.includes(saved.calId)) S.events.push(saved);
        render(); status('Saved to Google Calendar');
      } catch (e) { done = false; input.disabled = false; if (e && e.code === 'auth') return showSignIn(); status(msg(e), true); }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== row.querySelector('.more')) commit(); }, 150));
    row.querySelector('.more').addEventListener('mousedown', e => e.preventDefault());
    row.querySelector('.more').addEventListener('click', () => { const v = input.value; cancel(); openEditor(null, day, { title: v }); });
    input.focus();
  }

  // ---------- panel interactions ----------
  panel.addEventListener('click', e => {
    if (e.target.closest('.quickrow') || e.target.closest('textarea')) return;
    const evEl = e.target.closest('[data-i]');
    if (evEl) { const ev = S.events[+evEl.dataset.i]; if (ev) openEditor(ev); return; }
    const sel = e.target.closest('[data-sel]');
    if (sel) { S.selDay = sel.dataset.sel; render(); return; }
    const add = e.target.closest('[data-add]');
    if (add) { if (!isRO()) openEditor(null, add.dataset.add); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { S.view = 'week'; pref('view', 'week'); S.weekStart = startOfWeek(go.dataset.goto); load(); window.scrollTo(0, 0); return; }
    const half = e.target.closest('.half, .cell');
    if (half) { const day = half.dataset.day || half.querySelector('.plans').dataset.for; startQuick(day); return; }
    const ad = e.target.closest('.adbg');
    if (ad) { if (!isRO()) openEditor(null, ad.dataset.day); return; }
    const col = e.target.closest('.col');
    if (col && !isRO()) {
      const hourPx = col.offsetHeight / 24;
      const mins = Math.floor((e.clientY - col.getBoundingClientRect().top) / hourPx * 2) * 30;
      const h = Math.min(23, Math.floor(mins / 60)), m = mins % 60;
      const end = Math.min(23 * 60 + 59, mins + 60);
      openEditor(null, col.dataset.day, { allDay: false, startT: pad(h) + ':' + pad(m), endT: pad(Math.floor(end / 60)) + ':' + pad(end % 60) });
    }
  });
  // ---------- drag plans between weekend days ----------
  let drag = null, hl = null;
  const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY_MS);
  function dayUnder(e) {
    const wkd = e.target.closest && e.target.closest('[data-drop]');
    if (!wkd) return null;
    const halves = [...wkd.querySelectorAll('.half')];
    const hit = halves.find(h => { const r = h.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
    return (hit || (e.clientX < halves[0].getBoundingClientRect().left ? halves[0] : halves[halves.length - 1])).dataset.day;
  }
  function highlight(day) {
    if (hl === day) return;
    hl = day;
    panel.querySelectorAll('.half.drop').forEach(h => h.classList.remove('drop'));
    if (day) { const h = panel.querySelector(`.half[data-day="${day}"]`); if (h) h.classList.add('drop'); }
  }
  function endDrag() {
    drag = null; highlight(null);
    document.body.classList.remove('is-dragging');
    panel.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
  }
  panel.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest('.chip[data-i], .bar[data-i]');
    if (!el || S.view === 'week') return;
    const ev = S.events[+el.dataset.i];
    if (!ev || !canEdit(ev)) { e.preventDefault(); return; }
    drag = { ev, from: dayUnder(e) || el.dataset.day || el.closest('.row').dataset.sat };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ev.title);
    document.body.classList.add('is-dragging');
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  panel.addEventListener('dragover', e => {
    if (!drag) return;
    const d = dayUnder(e);
    highlight(d);
    if (d) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  panel.addEventListener('drop', e => {
    if (!drag) return;
    e.preventDefault();
    const d = dayUnder(e), { ev, from } = drag;
    endDrag();
    if (d && d !== from) moveEvent(ev, daysBetween(from, d));
  });
  panel.addEventListener('dragend', endDrag);
  document.addEventListener('dragleave', e => { if (drag && !e.relatedTarget) highlight(null); });

  async function moveEvent(ev, delta) {
    const data = { id: ev.id, calId: ev.calId, title: ev.title, allDay: ev.allDay, location: ev.location, description: ev.description };
    const backup = Object.assign({}, ev);
    const shift = ms => { const d = new Date(ms); d.setDate(d.getDate() + delta); return d.getTime(); };
    if (ev.allDay) {
      data.startDate = addDays(ev.start, delta); data.endDate = addDays(ev.end, delta - 1);
      ev.start = data.startDate; ev.end = addDays(ev.end, delta);
    } else {
      data.startDate = addDays(evStartDay(ev), delta); data.startTime = timeVal(ev.startMs);
      data.endDate = addDays(ymd(new Date(ev.endMs)), delta); data.endTime = timeVal(ev.endMs);
      ev.startMs = shift(ev.startMs); ev.endMs = shift(ev.endMs);
    }
    render();
    status('Moving…', true);
    try {
      const saved = await api('saveEvent', data);
      Object.assign(ev, saved);
      render();
      status(`Moved to ${DOW[dow(data.startDate)]} ${shortDate(data.startDate)}`);
    } catch (err) {
      Object.keys(ev).forEach(k => delete ev[k]); Object.assign(ev, backup);
      render();
      status('Couldn’t move: ' + msg(err), true);
    }
  }

  // ---------- editor ----------
  let editing = null;
  const writable = () => S.calendars.filter(c => c.writable !== false && (S.selected.includes(c.id) || c.id === S.defaultCal));
  function openEditor(ev, day, opts = {}) {
    editing = ev;
    $('evErr').textContent = '';
    $('evTitle').textContent = ev ? 'Edit plan' : 'New plan';
    const list = ev ? S.calendars.filter(c => c.id === ev.calId) : writable();
    $('fCal').innerHTML = list.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('fCal').value = ev ? ev.calId : (S.defaultCal || (list[0] && list[0].id));
    $('fCal').disabled = !!ev;
    $('fTitle').value = ev ? ev.title : (opts.title || '');
    $('fAllDay').checked = ev ? ev.allDay : opts.allDay !== false;
    $('fStart').value = ev ? evStartDay(ev) : day;
    $('fEnd').value = ev ? evEndDay(ev) : day;
    $('fStartT').value = ev && !ev.allDay ? timeVal(ev.startMs) : (opts.startT || '10:00');
    $('fEndT').value = ev && !ev.allDay ? timeVal(ev.endMs) : (opts.endT || '11:00');
    $('fLoc').value = ev ? ev.location : '';
    $('fDesc').value = ev ? ev.description : '';
    $('timeRow').hidden = $('fAllDay').checked;
    const cal = ev && calById(ev.calId);
    const ro = !!(ev && ((cal && cal.writable === false) || isRO()));
    $('evHint').textContent = ro ? (isRO() ? 'This is a read-only shared view.' : 'You can only view this calendar.') : (ev && ev.recurring ? 'Repeating event: changes apply to this day only.' : '');
    ['fTitle', 'fAllDay', 'fStart', 'fEnd', 'fStartT', 'fEndT', 'fLoc', 'fDesc'].forEach(id => $(id).disabled = ro);
    $('evSave').hidden = ro;
    $('evDelete').hidden = !ev || ro;
    $('evDelete').dataset.confirm = ''; $('evDelete').textContent = 'Delete';
    const d = parse(ev ? evStartDay(ev) : day);
    $('evOpen').href = (ev && ev.link) || `https://calendar.google.com/calendar/r/week/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    $('evOpen').hidden = !ev;
    $('evScrim').classList.add('open');
    if (!ro) setTimeout(() => $('fTitle').focus(), 30);
  }
  const closeEditor = () => { $('evScrim').classList.remove('open'); editing = null; };
  $('fAllDay').addEventListener('change', () => $('timeRow').hidden = $('fAllDay').checked);
  $('fStart').addEventListener('change', () => { if ($('fEnd').value < $('fStart').value) $('fEnd').value = $('fStart').value; });
  $('evCancel').addEventListener('click', closeEditor);
  $('evScrim').addEventListener('mousedown', e => { if (e.target === $('evScrim')) closeEditor(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeEditor(); closeCals(); closeThemes(); } });

  $('evForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = {
      id: editing && editing.id, calId: $('fCal').value, title: $('fTitle').value, allDay: $('fAllDay').checked,
      startDate: $('fStart').value, endDate: $('fEnd').value, startTime: $('fStartT').value, endTime: $('fEndT').value,
      location: $('fLoc').value, description: $('fDesc').value
    };
    $('evSave').disabled = true; $('evErr').textContent = '';
    try {
      const saved = await api('saveEvent', data);
      if (editing) S.events = S.events.filter(x => x !== editing);
      if (S.selected.includes(saved.calId)) S.events.push(saved);
      closeEditor(); render(); status('Saved to Google Calendar');
    } catch (err) { if (err && err.code === 'auth') { closeEditor(); return showSignIn(); } $('evErr').textContent = msg(err); }
    $('evSave').disabled = false;
  });

  $('evDelete').addEventListener('click', async () => {
    if (!editing) return;
    if ($('evDelete').dataset.confirm !== '1') { $('evDelete').dataset.confirm = '1'; $('evDelete').textContent = 'Really delete?'; return; }
    try {
      await api('deleteEvent', editing.calId, editing.id);
      const gone = editing;
      S.events = S.events.filter(x => x !== gone);
      closeEditor(); render(); status('Deleted');
    } catch (err) { if (err && err.code === 'auth') { closeEditor(); return showSignIn(); } $('evErr').textContent = msg(err); }
  });

  // ---------- calendar picker ----------
  function openCals() {
    $('calList').innerHTML = S.calendars.map((c, i) => `
      <label><input type="checkbox" value="${esc(c.id)}" ${S.selected.includes(c.id) ? 'checked' : ''}>
        <span class="dot" style="background:var(--p${i % 6 + 1})"></span><span>${esc(c.name)}</span>
        <span class="def"><input type="radio" name="def" value="${esc(c.id)}" ${S.defaultCal === c.id ? 'checked' : ''} ${c.writable === false ? 'disabled title="View only"' : ''}> New</span></label>`).join('');
    $('me').textContent = S.me ? 'Signed in as ' + S.me : '';
    $('calScrim').classList.add('open');
  }
  const closeCals = () => $('calScrim').classList.remove('open');

  // ---------- theme picker ----------
  function openThemes() {
    const cur = document.documentElement.dataset.theme || 'paper';
    $('themeList').innerHTML = THEMES.map(t => `<button class="theme-opt${t.id === cur ? ' on' : ''}" data-theme-id="${t.id}" aria-pressed="${t.id === cur}"><span class="sw">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><span class="nm">${t.name}</span></button>`).join('');
    $('themeScrim').classList.add('open');
  }
  $('themeBtn').addEventListener('click', openThemes);
  $('themeList').addEventListener('click', e => {
    const b = e.target.closest('[data-theme-id]'); if (!b) return;
    setTheme(b.dataset.themeId);
    $('themeList').querySelectorAll('.theme-opt').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  });
  const closeThemes = () => $('themeScrim').classList.remove('open');
  $('themeDone').addEventListener('click', closeThemes);
  $('themeScrim').addEventListener('mousedown', e => { if (e.target === $('themeScrim')) closeThemes(); });
  $('calBtn').addEventListener('click', openCals);
  $('calScrim').addEventListener('mousedown', e => { if (e.target === $('calScrim')) $('calDone').click(); });
  $('calDone').addEventListener('click', async () => {
    const sel = [...$('calList').querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    const def = ($('calList').querySelector('input[type=radio]:checked') || {}).value || S.defaultCal;
    closeCals();
    const changed = sel.join() !== S.selected.join() || def !== S.defaultCal;
    S.selected = sel; S.defaultCal = def;
    if (changed) { if (!S.shared) api('savePrefs', sel, def).catch(() => {}); load(false); }
  });

  // ---------- nav ----------
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    if (S.view === b.dataset.view) return;
    S.view = b.dataset.view; pref('view', S.view);
    window.scrollTo(0, 0); load(S.view === 'weekends');
  }));
  const shiftMonth = n => { const d = new Date(S.month.y, S.month.m + n, 1); S.month = { y: d.getFullYear(), m: d.getMonth() }; };
  $('prev').addEventListener('click', () => { if (S.view === 'weekends') S.year--; else if (S.view === 'month') shiftMonth(-1); else S.weekStart = addDays(S.weekStart, -7); load(false); window.scrollTo(0, 0); });
  $('next').addEventListener('click', () => { if (S.view === 'weekends') S.year++; else if (S.view === 'month') shiftMonth(1); else S.weekStart = addDays(S.weekStart, 7); load(false); window.scrollTo(0, 0); });
  $('todayBtn').addEventListener('click', () => {
    if (S.view === 'week') { S.weekStart = startOfWeek(today()); load(); return; }
    if (S.view === 'month') { const d = new Date(); S.month = { y: d.getFullYear(), m: d.getMonth() }; load(); return; }
    if (S.year !== new Date().getFullYear()) { S.year = new Date().getFullYear(); load(true); } else scrollToNow();
  });
  $('refresh').addEventListener('click', () => load(false));
  $('showFri').addEventListener('change', () => { S.showFri = $('showFri').checked; pref('showFri', S.showFri ? '1' : '0'); render(); });
  $('hidePast').checked = S.hidePast;
  $('hidePast').addEventListener('change', () => { S.hidePast = $('hidePast').checked; pref('hidePast', S.hidePast ? '1' : '0'); render(); });
  $('weekStart').addEventListener('change', () => {
    S.weekStartDay = Number($('weekStart').value); pref('weekStartDay', String(S.weekStartDay));
    S.weekStart = startOfWeek(S.weekStart); load();
  });
  window.addEventListener('resize', () => document.documentElement.style.setProperty('--header-h', $('hdr').offsetHeight + 'px'));
  matchMedia('(max-width: 760px)').addEventListener('change', () => { if (S.calendars.length) render(); });

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function msg(e) { return (e && (e.message || e.toString())) || 'Something went wrong'; }

  // ---------- local preview data (used only when opened outside the extension) ----------
  const Mock = {
    _ev: [], _notes: {},
    getBootstrap() {
      const y = new Date().getFullYear(), w = weekends(y), sat = n => w[n].sat;
      const ws = startOfWeek(today()), at = (d, h) => dayStart(d) + h * 3600000;
      const nowIdx = w.findIndex(x => x.sun >= today());
      const k = i => sat(Math.max(0, Math.min(w.length - 1, nowIdx + i)));
      this._ev = [
        { id: 'a', calId: 'p', title: 'Ski trip – Tahoe', allDay: true, start: addDays(sat(2), -1), end: addDays(sat(2), 2) },
        { id: 'b', calId: 'p', title: 'Pottery class', allDay: false, startMs: at(sat(5), 11), endMs: at(sat(5), 14) },
        { id: 'c', calId: 's', title: 'Dinner party', allDay: true, start: addDays(sat(5), 1), end: addDays(sat(5), 2) },
        { id: 'd', calId: 's', title: 'Camping – Big Sur', allDay: true, start: k(1), end: addDays(k(1), 2) },
        { id: 'e', calId: 'p', title: 'Visiting family', allDay: true, start: addDays(k(3), -2), end: addDays(k(4), 2) },
        { id: 'f', calId: 'p', title: 'Farmers market', allDay: false, startMs: at(k(0), 9), endMs: at(k(0), 10), recurring: true },
        { id: 'g', calId: 's', title: 'Brunch w/ Liz', allDay: false, startMs: at(addDays(k(0), 1), 11), endMs: at(addDays(k(0), 1), 12.5) },
        { id: 'h', calId: 'p', title: 'Team coffee', allDay: false, startMs: at(addDays(ws, 2), 12), endMs: at(addDays(ws, 2), 13.5) },
        { id: 'i', calId: 'p', title: 'Design review', allDay: false, startMs: at(addDays(ws, 2), 13), endMs: at(addDays(ws, 2), 14) },
        { id: 'k', calId: 's', title: 'Movie night', allDay: false, startMs: at(addDays(k(2), -1), 19), endMs: at(addDays(k(2), -1), 21.5) },
        { id: 'l', calId: 'p', title: 'Mendo trip', allDay: true, start: addDays(k(5), -1), end: addDays(k(5), 1) },
        { id: 'j', calId: 's', title: 'Craft club', allDay: false, startMs: at(addDays(ws, 4), 18.5), endMs: at(addDays(ws, 4), 20.5) }
      ].map(e => Object.assign({ location: '', description: '' }, e));
      this._notes[k(1)] = 'book campsite!';
      return Promise.resolve({ me: 'you@example.com', selected: ['p', 's'], defaultCal: 's', calendars: [
        { id: 'p', name: 'Personal', color: '#039be5', owned: true, writable: true, primary: true },
        { id: 's', name: 'Weekends (shared)', color: '#e67c73', owned: false, writable: true },
        { id: 'w', name: 'Work', color: '#616161', owned: true, writable: true }] });
    },
    getRange(from, to, ids) { const out = this._ev.filter(e => ids.includes(e.calId)); out.failed = ids.filter(id => !['p', 's', 'w'].includes(id)); return Promise.resolve(out); },
    getNotes() { return Promise.resolve(Object.assign({}, this._notes)); },
    setNote(k, v) { this._notes[k] = v; return Promise.resolve(true); },
    savePrefs() { return Promise.resolve(true); },
    saveEvent(d) {
      const o = { id: d.id || String(Math.random()), calId: d.calId, title: d.title, allDay: d.allDay, location: d.location || '', description: d.description || '' };
      if (d.allDay) { o.start = d.startDate; o.end = addDays(d.endDate || d.startDate, 1); }
      else { const [h1, m1] = d.startTime.split(':').map(Number), [h2, m2] = d.endTime.split(':').map(Number); o.startMs = dayStart(d.startDate) + h1 * 36e5 + m1 * 6e4; o.endMs = dayStart(d.endDate || d.startDate) + h2 * 36e5 + m2 * 6e4; }
      this._ev = this._ev.filter(x => x.id !== o.id); this._ev.push(o); return Promise.resolve(o);
    },
    deleteEvent(c, id) { this._ev = this._ev.filter(x => x.id !== id); return Promise.resolve(true); }
  };

  // ---------- share links ----------
  // A link carries the view in the URL hash: #view=month&date=2026-11&cals=a@gmail.com,b@gmail.com&ro=1
  function readShared() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('cals') && !h.get('view')) return null;
    return {
      view: ['weekends', 'month', 'week'].includes(h.get('view')) ? h.get('view') : 'weekends',
      date: h.get('date') || '',
      cals: (h.get('cals') || '').split(',').map(decodeURIComponent).filter(Boolean),
      ro: h.get('ro') === '1',
      from: h.get('from') || ''
    };
  }
  function applyShared() {
    const sh = readShared();
    if (!sh) return;
    S.shared = sh;
    S.view = sh.view;
    const d = sh.date;
    if (sh.view === 'weekends' && /^\d{4}$/.test(d)) S.year = +d;
    if (sh.view === 'month' && /^\d{4}-\d{2}$/.test(d)) S.month = { y: +d.slice(0, 4), m: +d.slice(5, 7) - 1 };
    if (sh.view === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(d)) S.weekStart = startOfWeek(d);
    if (sh.cals.length) {
      S.selected = sh.cals.slice();
      // calendars that aren't in this person's list still get a colour slot (read through Google if shared with them)
      sh.cals.forEach(id => { if (!calById(id)) S.calendars.push({ id, name: id, writable: false, external: true }); });
    }
    document.body.classList.toggle('readonly', sh.ro);
  }
  function exitShared() {
    history.replaceState(null, '', location.pathname);
    location.reload();
  }
  window.addEventListener('hashchange', () => location.reload());

  function renderBanner() {
    const el = $('banner');
    if (!S.shared && !S.failed.length) { el.hidden = true; return; }
    const names = S.selected.map(id => (calById(id) || { name: id }).name);
    const parts = [];
    if (S.shared) parts.push(`<b>Shared view${S.shared.from ? ' from ' + esc(S.shared.from) : ''}</b>${S.shared.ro ? ' · read-only' : ''} · ${esc(names.join(', '))}`);
    if (S.failed.length) parts.push(`<span class="warn">Can’t see ${esc(S.failed.map(id => (calById(id) || { name: id }).name).join(', '))}. Ask the owner to share it with you in Google Calendar.</span>`);
    el.innerHTML = parts.join('<br>') + (S.shared ? ' <button class="pill ghost small" id="exitShared">Back to my calendar</button>' : '');
    el.hidden = false;
    const x = $('exitShared'); if (x) x.addEventListener('click', exitShared);
  }

  function viewDate() {
    if (S.view === 'weekends') return String(S.year);
    if (S.view === 'month') return `${S.month.y}-${pad(S.month.m + 1)}`;
    return S.weekStart;
  }
  function shareLink() {
    const cals = [...$('shareCals').querySelectorAll('input:checked')].map(i => i.value);
    const q = new URLSearchParams({ view: S.view, date: viewDate() });
    if (cals.length) q.set('cals', cals.join(','));
    if ($('shareRO').checked) q.set('ro', '1');
    if (S.me) q.set('from', S.me);
    const base = location.href.split('#')[0].split('?')[0];
    return base + '#' + q.toString().replace(/%2C/g, ',').replace(/%40/g, '@');
  }
  function openShare() {
    $('shareCals').innerHTML = S.calendars.filter(c => S.selected.includes(c.id)).map(c =>
      `<label><input type="checkbox" value="${esc(c.id)}" checked><span class="dot" style="background:var(--p${slot(c.id)})"></span><span>${esc(c.name)}</span></label>`).join('');
    $('shareRO').checked = true;
    const upd = () => { $('shareLink').value = shareLink(); $('copyShare').textContent = 'Copy link'; };
    $('shareCals').onchange = upd; $('shareRO').onchange = upd;
    upd();
    $('shareScrim').classList.add('open');
  }
  const closeShare = () => $('shareScrim').classList.remove('open');
  $('shareBtn').addEventListener('click', openShare);
  $('shareDone').addEventListener('click', closeShare);
  $('shareScrim').addEventListener('mousedown', e => { if (e.target === $('shareScrim')) closeShare(); });
  $('copyShare').addEventListener('click', async () => {
    const v = $('shareLink').value;
    try { await navigator.clipboard.writeText(v); } catch (e) { $('shareLink').select(); document.execCommand('copy'); }
    $('copyShare').textContent = 'Copied!';
  });

  // ---------- boot ----------
  function showSignIn(err) {
    status('');
    document.body.classList.add('signed-out');
    panel.innerHTML = `<div class="signin">
      <div class="signin-mark">◐</div>
      <h2>Weekends</h2>
      <p>Your year, one weekend at a time, straight from Google Calendar.</p>
      <button class="pill big" id="signinBtn">Sign in with Google</button>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      <p class="hint">Plans are read and saved directly between your browser and Google. Nothing is stored anywhere else.</p>
    </div>`;
    $('signinBtn').addEventListener('click', async () => {
      try { await window.CalendarAPI.signIn(); start(); }
      catch (e) { showSignIn(msg(e)); }
    });
  }

  async function start() {
    try {
      const b = await api('getBootstrap');
      document.body.classList.remove('signed-out');
      Object.assign(S, { calendars: b.calendars, selected: b.selected, defaultCal: b.defaultCal, me: b.me });
      applyShared();
      await load(S.view === 'weekends' && !S.shared);
    } catch (e) {
      if (e && e.code === 'auth') return showSignIn();
      panel.innerHTML = `<div class="loading">Couldn’t connect to Google Calendar (${esc(msg(e))}).<br><br><button class="pill" id="connect">Connect Google Calendar</button></div>`;
      $('connect').addEventListener('click', () => location.reload());
    }
  }

  setTimeout(() => {
    if (!MOCK && window.CalendarAPI && window.CalendarAPI.needsSignIn()) showSignIn(); else start();
  }, 0);
})();
