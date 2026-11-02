// Google Calendar REST layer for Weekends (talks to Google directly from the browser).
// Exposes window.CalendarAPI with the same methods the page expects.
(function () {
  const BASE = 'https://www.googleapis.com/calendar/v3';
  const EVENT_COLORS = {
    '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
    '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
  };
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let calColors = {};

  // ---------- auth: Chrome extension (chrome.identity) or website (Google Identity Services) ----------
  const IS_EXT = !!(window.chrome && chrome.identity && chrome.identity.getAuthToken);
  const CFG = window.WEEKENDS_CONFIG || {};
  const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
  // Google's access token lives only in memory for this page; nothing about your sign-in is saved.
  let webTok = null, tokenClient = null;

  function webTokenValid() { return !!(webTok && webTok.exp > Date.now() + 60000); }

  // Needs a user gesture (opens Google's sign-in popup).
  function webSignIn() {
    return new Promise((resolve, reject) => {
      if (!(window.google && google.accounts && google.accounts.oauth2)) return reject(new Error('Google sign-in didn’t load. Check your connection and reload.'));
      if (!CFG.webClientId) return reject(new Error('No Google Client ID configured for this site.'));
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({ client_id: CFG.webClientId, scope: SCOPES, callback: () => {} });
      tokenClient.callback = r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        webTok = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        resolve(webTok.t);
      };
      tokenClient.error_callback = e => reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in was closed.' : 'Sign-in didn’t finish.'));
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  class AuthNeeded extends Error { constructor() { super('Sign in with Google to see your calendar.'); this.code = 'auth'; } }

  async function token() {
    if (IS_EXT) {
      const r = await chrome.identity.getAuthToken({ interactive: true });
      const t = typeof r === 'string' ? r : r && r.token;
      if (!t) throw new Error('Not signed in to Google');
      return t;
    }
    if (webTokenValid()) return webTok.t;
    throw new AuthNeeded();
  }

  async function dropToken(t) {
    if (IS_EXT) return chrome.identity.removeCachedAuthToken({ token: t });
    webTok = null;
  }

  async function gfetch(path, opts = {}, retried) {
    const t = await token();
    const res = await fetch(BASE + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (res.status === 401) {
      await dropToken(t);
      if (IS_EXT && !retried) return gfetch(path, opts, true);
      throw new AuthNeeded();
    }
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || ('Google Calendar error ' + res.status));
    return body;
  }

  async function paged(path) {
    let items = [], pageToken = '';
    do {
      const sep = path.includes('?') ? '&' : '?';
      const r = await gfetch(path + (pageToken ? sep + 'pageToken=' + encodeURIComponent(pageToken) : ''));
      items = items.concat(r.items || []);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return items;
  }

  // settings: Chrome sync storage in the extension, browser storage on the website
  const LS = {
    get(keys) { const out = {}; try { const all = JSON.parse(localStorage.getItem('wk_store') || '{}'); (keys === null ? Object.keys(all) : [].concat(keys)).forEach(k => { if (k in all) out[k] = all[k]; }); } catch (e) {} return Promise.resolve(out); },
    set(obj) { try { const all = JSON.parse(localStorage.getItem('wk_store') || '{}'); Object.assign(all, obj); localStorage.setItem('wk_store', JSON.stringify(all)); } catch (e) {} return Promise.resolve(); },
    remove(keys) { try { const all = JSON.parse(localStorage.getItem('wk_store') || '{}'); [].concat(keys).forEach(k => delete all[k]); localStorage.setItem('wk_store', JSON.stringify(all)); } catch (e) {} return Promise.resolve(); }
  };
  const store = IS_EXT && chrome.storage && chrome.storage.sync ? {
    get: keys => chrome.storage.sync.get(keys),
    set: obj => chrome.storage.sync.set(obj),
    remove: keys => chrome.storage.sync.remove(keys)
  } : LS;

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n, 12)); };

  function serialize(ev, calId) {
    const allDay = !!(ev.start && ev.start.date);
    const o = {
      id: ev.id, calId,
      title: ev.summary || '(no title)',
      allDay,
      location: ev.location || '',
      description: ev.description || '',
      color: EVENT_COLORS[ev.colorId] || calColors[calId] || '#2f6f5e',
      recurring: !!ev.recurringEventId,
      link: ev.htmlLink || ''
    };
    if (allDay) { o.start = ev.start.date; o.end = ev.end.date; }
    else { o.startMs = Date.parse(ev.start.dateTime); o.endMs = Date.parse(ev.end.dateTime); }
    return o;
  }

  window.CalendarAPI = {
    isExtension: IS_EXT,
    needsSignIn() { return !IS_EXT && !webTokenValid(); },
    signIn: webSignIn,
    async getBootstrap() {
      const cals = await paged('/users/me/calendarList?minAccessRole=reader&maxResults=250');
      const calendars = cals
        .filter(c => !c.hidden)
        .map(c => ({
          id: c.id,
          name: c.summaryOverride || c.summary,
          color: c.backgroundColor,
          owned: c.accessRole === 'owner',
          writable: c.accessRole === 'owner' || c.accessRole === 'writer',
          primary: !!c.primary
        }))
        .sort((a, b) => (b.primary - a.primary) || (b.owned - a.owned) || a.name.localeCompare(b.name));
      calColors = Object.fromEntries(calendars.map(c => [c.id, c.color]));
      const primary = calendars.find(c => c.primary) || calendars[0];
      const prefs = await store.get(['selected', 'defaultCal']);
      let selected = (prefs.selected || [primary.id]).filter(id => calColors[id]);
      if (!selected.length) selected = [primary.id];
      let defaultCal = prefs.defaultCal && calendars.some(c => c.id === prefs.defaultCal && c.writable) ? prefs.defaultCal : primary.id;
      return { me: primary.id, calendars, selected, defaultCal };
    },

    async savePrefs(selected, defaultCal) {
      await store.set({ selected, defaultCal });
      return true;
    },

    async getEvents(year, ids) {
      return this.getRange(ymd(new Date(year, 0, 1 - 3, 12)), ymd(new Date(year + 1, 0, 1 + 9, 12)), ids);
    },

    // Events overlapping [from, to) — both 'YYYY-MM-DD', local time.
    async getRange(from, to, ids) {
      const [fy, fm, fd] = from.split('-').map(Number), [ty, tm, td] = to.split('-').map(Number);
      const timeMin = new Date(fy, fm - 1, fd).toISOString();
      const timeMax = new Date(ty, tm - 1, td).toISOString();
      const seen = {}, out = [];
      const lists = await Promise.all((ids || []).map(id =>
        paged(`/calendars/${encodeURIComponent(id)}/events?singleEvents=true&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
          .then(items => ({ id, items }))
          .catch(err => ({ id, items: [], failed: true }))));
      out.failed = lists.filter(l => l.failed).map(l => l.id);
      lists.forEach(({ id, items }) => items.forEach(ev => {
        if (ev.status === 'cancelled') return;
        if (ev.eventType === 'workingLocation' || ev.eventType === 'focusTime') return;
        const me = (ev.attendees || []).find(a => a.self);
        if (me && me.responseStatus === 'declined') return;
        const o = serialize(ev, id);
        const key = (ev.iCalUID || ev.id) + '|' + (o.start || o.startMs);
        if (seen[key]) return;
        seen[key] = true;
        out.push(o);
      }));
      return out;
    },

    async saveEvent(d) {
      if (!d.title || !d.title.trim()) throw new Error('Give it a name first.');
      const body = { summary: d.title.trim(), location: d.location || '', description: d.description || '' };
      if (d.allDay) {
        body.start = { date: d.startDate };
        body.end = { date: addDays(d.endDate || d.startDate, 1) };
        if (body.end.date <= body.start.date) throw new Error('The end has to be after the start.');
      } else {
        const s = d.startDate + 'T' + d.startTime + ':00', e = (d.endDate || d.startDate) + 'T' + d.endTime + ':00';
        if (e <= s) throw new Error('The end has to be after the start.');
        body.start = { dateTime: s, timeZone: TZ };
        body.end = { dateTime: e, timeZone: TZ };
      }
      const cal = encodeURIComponent(d.calId);
      const ev = d.id
        ? await gfetch(`/calendars/${cal}/events/${encodeURIComponent(d.id)}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await gfetch(`/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify(body) });
      return serialize(ev, d.calId);
    },

    async deleteEvent(calId, id) {
      await gfetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return true;
    },

    // Notes live in Chrome sync storage: private to you, synced across your Chrome browsers.
    async getNotes(year) {
      const all = await store.get(null);
      const out = {};
      Object.keys(all).forEach(k => { if (k.startsWith('n:' + year)) out[k.slice(2)] = all[k]; });
      return out;
    },

    async setNote(sat, text) {
      if (text && text.trim()) await store.set({ ['n:' + sat]: text.trim().slice(0, 4000) });
      else await store.remove('n:' + sat);
      return true;
    },

    async signOut() {
      try {
        if (IS_EXT) {
          const t = await token();
          await fetch('https://accounts.google.com/o/oauth2/revoke?token=' + t);
          await chrome.identity.removeCachedAuthToken({ token: t });
        } else if (webTok) {
          google.accounts.oauth2.revoke(webTok.t, () => {});
          await dropToken();
        }
      } catch (e) {}
      return true;
    }
  };
})();
