/**
 * admin.bundle.js — Standalone Universal Admin Dashboard Engine
 * Works seamlessly over http://, https://, and file:// protocols.
 * Zero module-CORS issues. Full Supabase + Offline LocalStorage support.
 */

(function () {
  'use strict';

  // ─── SUPABASE CONFIGURATION ────────────────────────────────────────────────
  const SUPABASE_URL = 'https://oeqjnztdfbgttbjijmbm.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_YFyle0-xjuizV0IzfUroFg_vSCsBt5c';

  let supabase = null;
  try {
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
  } catch (e) {
    console.warn('Supabase initialization notice (running in safe mode):', e);
  }

  // ─── LOCAL / OFFLINE PERSISTENCE ───────────────────────────────────────────
  const LOCAL_LINKS_KEY = 'alj_local_links_db';
  const LOCAL_VISITORS_KEY = 'alj_local_visitors_db';
  const localBus = new EventTarget();

  function getLocalTable(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLocalTable(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localBus.dispatchEvent(new CustomEvent('change', { detail: { key } }));
    } catch (e) {
      console.warn('LocalStorage notice:', e);
    }
  }

  // ─── DATABASE BRIDGE ───────────────────────────────────────────────────────

  function cleanData(data) {
    if (!data || typeof data !== 'object') return data;
    const result = {};
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue;
      if (val && typeof val === 'object' && val._methodName === 'serverTimestamp') {
        result[key] = new Date().toISOString();
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  const db = {
    async getDoc(table, id) {
      if (supabase) {
        try {
          const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
          if (!error && data) return { exists: () => true, data: () => data, id: data.id };
        } catch {}
      }
      const key = table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
      const list = getLocalTable(key);
      const found = list.find(item => item.id === id);
      return { exists: () => !!found, data: () => found || {}, id };
    },

    async setDoc(table, id, rawData, linkId) {
      const payload = cleanData({ id, ...(linkId ? { linkId } : {}), ...rawData });
      const key = table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
      const list = getLocalTable(key);
      const idx = list.findIndex(i => i.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], ...payload };
      else list.unshift(payload);
      saveLocalTable(key, list);

      if (supabase) {
        try { await supabase.from(table).upsert(payload); } catch {}
      }
    },

    async updateDoc(table, id, rawData) {
      const payload = cleanData(rawData);
      const key = table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
      const list = getLocalTable(key);
      const idx = list.findIndex(i => i.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...payload, lastUpdatedAt: new Date().toISOString() };
        saveLocalTable(key, list);
      }
      if (supabase) {
        try { await supabase.from(table).update(payload).eq('id', id); } catch {}
      }
    },

    async deleteDoc(table, id) {
      const key = table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
      let list = getLocalTable(key);
      list = list.filter(i => i.id !== id);
      saveLocalTable(key, list);
      if (supabase) {
        try { await supabase.from(table).delete().eq('id', id); } catch {}
      }
    },

    onSnapshot(table, parentLinkId, onNext) {
      const storeKey = table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;

      async function refresh() {
        let rows = null;
        if (supabase) {
          try {
            let req = supabase.from(table).select('*').order('createdAt', { ascending: false });
            if (parentLinkId) req = req.eq('linkId', parentLinkId);
            const { data, error } = await req;
            if (!error && Array.isArray(data) && data.length > 0) rows = data;
          } catch {}
        }
        if (!rows) {
          let local = getLocalTable(storeKey);
          if (parentLinkId) local = local.filter(item => item.linkId === parentLinkId);
          rows = local;
        }
        if (onNext) {
          onNext({
            docs: (rows || []).map(r => ({ id: r.id, data: () => r })),
            size: (rows || []).length
          });
        }
      }

      refresh();

      const listener = () => refresh();
      localBus.addEventListener('change', listener);
      window.addEventListener('storage', listener);

      let channel = null;
      if (supabase) {
        try {
          channel = supabase.channel(`rt_${table}_${parentLinkId || 'all'}_${Math.random().toString(36).slice(2, 6)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table }, () => refresh())
            .subscribe();
        } catch {}
      }

      return () => {
        localBus.removeEventListener('change', listener);
        window.removeEventListener('storage', listener);
        if (channel && supabase) supabase.removeChannel(channel);
      };
    }
  };

  // ─── AUTH BRIDGE ───────────────────────────────────────────────────────────

  function formatUser(u) {
    if (!u) return null;
    return { ...u, uid: u.id || u.uid || 'admin-uid' };
  }

  const auth = {
    onAuthStateChanged(callback) {
      if (supabase) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user) return callback(formatUser(session.user));
          const local = sessionStorage.getItem('alj_local_admin');
          callback(local ? JSON.parse(local) : null);
        }).catch(() => {
          const local = sessionStorage.getItem('alj_local_admin');
          callback(local ? JSON.parse(local) : null);
        });

        supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) callback(formatUser(session.user));
        });
      } else {
        const local = sessionStorage.getItem('alj_local_admin');
        callback(local ? JSON.parse(local) : null);
      }
    },

    async signIn(email, password) {
      if (supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data?.user) return formatUser(data.user);
      }
      const local = { uid: 'aa4e274f-997d-4fbe-a9f8-1614df99e302', email };
      sessionStorage.setItem('alj_local_admin', JSON.stringify(local));
      return local;
    },

    async signUp(email, password) {
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        return { user: formatUser(data.user), session: data.session };
      }
      const local = { uid: 'aa4e274f-997d-4fbe-a9f8-1614df99e302', email };
      sessionStorage.setItem('alj_local_admin', JSON.stringify(local));
      return { user: local, session: true };
    },

    async signOut() {
      sessionStorage.removeItem('alj_local_admin');
      if (supabase) {
        try { await supabase.auth.signOut(); } catch {}
      }
    }
  };

  // ─── ADMIN DASHBOARD LOGIC ─────────────────────────────────────────────────

  const adminState = {
    user: null,
    journeysUnsub: null,
    visitorsUnsubs: [],
    allJourneys: [],
    allVisitors: [],
    modalMapInstance: null
  };

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3400);
  }

  function generateLinkId(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return isNaN(d.getTime()) ? String(ts) : d.toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function shortId(id) {
    return id ? `#${id.substring(0, 4).toUpperCase()}` : '#????';
  }

  // ─── STARS CANVAS ───────────────────────────────────────────────────────────

  function initStars() {
    const canvas = document.getElementById('stars-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    let stars = [];
    function createStars() {
      stars = Array.from({ length: 80 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.2,
        a: Math.random(),
        da: (Math.random() - 0.5) * 0.006
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        s.a = Math.max(0.05, Math.min(1, s.a + s.da));
        if (s.a <= 0.05 || s.a >= 1) s.da *= -1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(196,181,253,${s.a})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => { resize(); createStars(); });
    resize(); createStars(); draw();
  }

  // ─── AUTH LOGIC ─────────────────────────────────────────────────────────────

  function showLogin() {
    const loginEl = document.getElementById('admin-login');
    const appEl = document.getElementById('admin-app');
    if (loginEl) loginEl.style.display = '';
    if (appEl) appEl.classList.remove('visible');
    teardownListeners();
  }

  function showDashboard() {
    const loginEl = document.getElementById('admin-login');
    const appEl = document.getElementById('admin-app');
    if (loginEl) loginEl.style.display = 'none';
    if (appEl) appEl.classList.add('visible');
    loadDashboard();
  }

  function teardownListeners() {
    if (adminState.journeysUnsub) {
      adminState.journeysUnsub();
      adminState.journeysUnsub = null;
    }
    adminState.visitorsUnsubs.forEach(u => u());
    adminState.visitorsUnsubs = [];
    adminState.allJourneys = [];
    adminState.allVisitors = [];
  }

  function loadDashboard() {
    teardownListeners();
    listenToJourneys();
  }

  function listenToJourneys() {
    adminState.journeysUnsub = db.onSnapshot('links', null, (snap) => {
      adminState.allJourneys = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      adminState.visitorsUnsubs.forEach(u => u());
      adminState.visitorsUnsubs = [];
      adminState.allVisitors = [];

      if (adminState.allJourneys.length === 0) {
        renderDashboard();
        return;
      }

      for (const journey of adminState.allJourneys) {
        const unsub = db.onSnapshot('visitors', journey.id, (vSnap) => {
          const visitors = vSnap.docs.map(d => ({ id: d.id, linkId: journey.id, ...d.data() }));
          adminState.allVisitors = [
            ...adminState.allVisitors.filter(v => v.linkId !== journey.id),
            ...visitors
          ];
          renderDashboard();
        });
        adminState.visitorsUnsubs.push(unsub);
      }
    });
  }

  // ─── DASHBOARD RENDERING ───────────────────────────────────────────────────

  function renderDashboard() {
    updateStats();
    renderJourneysAndVisitors();
  }

  function updateStats() {
    const visitors = adminState.allVisitors;
    const jEl = document.getElementById('stat-journeys');
    const vEl = document.getElementById('stat-visitors');
    const lEl = document.getElementById('stat-locations');
    const cEl = document.getElementById('stat-cameras');
    const coEl = document.getElementById('stat-completed');

    if (jEl) jEl.textContent = adminState.allJourneys.length;
    if (vEl) vEl.textContent = visitors.length;
    if (lEl) lEl.textContent = visitors.filter(v => v.locationPermission === 'granted').length;
    if (cEl) cEl.textContent = visitors.filter(v => v.videoUrl).length;
    if (coEl) coEl.textContent = visitors.filter(v => v.journeyCompleted).length;
  }

  function renderJourneysAndVisitors() {
    const container = document.getElementById('visitors-container');
    if (!container) return;
    container.innerHTML = '';

    if (adminState.allJourneys.length === 0) {
      container.innerHTML = `
        <div class="text-center" style="padding:var(--space-2xl);color:var(--text-muted);">
          <div style="font-size:2rem;margin-bottom:var(--space-md);">✦</div>
          <p>No journeys created yet. Click "✦ CREATE NEW JOURNEY" above.</p>
        </div>`;
      const badge = document.getElementById('visitors-count-badge');
      if (badge) badge.textContent = '0 journeys';
      return;
    }

    const badge = document.getElementById('visitors-count-badge');
    if (badge) badge.textContent = `${adminState.allJourneys.length} journey${adminState.allJourneys.length === 1 ? '' : 's'}`;

    for (const journey of adminState.allJourneys) {
      const journeyVisitors = adminState.allVisitors.filter(v => v.linkId === journey.id);
      const card = buildJourneyCard(journey, journeyVisitors);
      container.appendChild(card);
    }
  }

  const SITE_URL = '';

  function getJourneyURL(linkId) {
    const configured = (localStorage.getItem('alj_public_site_url') || SITE_URL).trim().replace(/\/+$/, '');
    const origin = configured || window.location.origin;
    if (!/^https:\/\//i.test(origin) || /localhost|127\.0\.0\.1/i.test(origin)) return '';
    return `${origin}/?id=${encodeURIComponent(linkId)}`;
  }

  function buildJourneyUrl(linkId) { return getJourneyURL(linkId); }

  function updatePublicUrlStatus() {
    const input = document.getElementById('public-site-url');
    const warning = document.getElementById('public-url-warning');
    const qr = document.getElementById('public-url-qr');
    const qrImage = document.getElementById('public-url-qr-image');
    if (!input || !warning) return;
    const configured = (localStorage.getItem('alj_public_site_url') || '').trim();
    input.value = configured;
    const local = !configured && (location.protocol === 'file:' || /localhost|127\.0\.0\.1/.test(location.hostname));
    warning.textContent = local
      ? 'Add your HTTPS Vercel or tunnel URL before sharing. Localhost and file links only work on this computer.'
      : 'Use an HTTPS URL that serves this folder publicly.';
    warning.className = `form-hint ${local ? 'form-hint-warning' : ''}`;
    if (configured && qr && qrImage) {
      qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`${configured.replace(/\/+$/, '')}/`)}`;
      qr.hidden = false;
    } else if (qr) {
      qr.hidden = true;
    }
  }

  function initPublicUrlSettings() {
    const save = document.getElementById('btn-save-public-url');
    const input = document.getElementById('public-site-url');
    if (!save || !input) return;
    updatePublicUrlStatus();
    save.addEventListener('click', () => {
      const value = input.value.trim().replace(/\/+$/, '');
      if (value && !/^https:\/\//i.test(value)) {
        showToast('Use an HTTPS public URL.', 'error');
        return;
      }
      localStorage.setItem('alj_public_site_url', value);
      updatePublicUrlStatus();
      renderDashboard();
      showToast(value ? 'Public URL saved. New links will use it.' : 'Public URL cleared.', 'success');
    });
  }

  function buildJourneyCard(journey, visitors) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = 'var(--space-xl)';

    const journeyUrl = buildJourneyUrl(journey.id);
    const hasLocation = journey.myLatitude != null && journey.myLongitude != null;

    card.innerHTML = `
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-sm);border-bottom:1px solid var(--border-glass);padding-bottom:var(--space-md);margin-bottom:var(--space-lg);">
        <div>
          <span style="font-family:monospace;font-size:1.05rem;color:var(--secondary);font-weight:700;">✦ Journey ${shortId(journey.id)}</span>
          <span class="badge ${journey.active ? 'badge-success' : 'badge-danger'}" style="margin-left:var(--space-sm);">
            ${journey.active ? 'ACTIVE' : 'INACTIVE'}
          </span>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">
            Created: ${formatTimestamp(journey.createdAt)} · ${hasLocation ? `Destination: ${journey.myLatitude.toFixed(4)}, ${journey.myLongitude.toFixed(4)}` : 'No GPS marker'}
          </div>
        </div>
        <div style="display:flex;gap:var(--space-sm);align-items:center;">
          ${journeyUrl ? `<button class="btn btn-ghost btn-sm" onclick="window.__adminCopyUrl('${journeyUrl}')">Copy Link</button><a href="${journeyUrl}" target="_blank" class="btn btn-ghost btn-sm">Open ↗</a>` : '<span class="badge badge-danger">Set HTTPS public URL</span>'}
          <button class="btn btn-ghost btn-sm" onclick="window.__adminToggleActive('${journey.id}', ${journey.active})">
            ${journey.active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>

      <div class="visitors-list">
        ${visitors.length === 0 ? `
          <div style="padding:var(--space-lg);text-align:center;color:var(--text-muted);font-size:0.9rem;">
            No one has opened this journey link yet. Share the link above!
          </div>` :
          visitors.map(v => buildVisitorItem(journey, v)).join('')
        }
      </div>
    `;

    return card;
  }

  function buildVisitorItem(journey, v) {
    const isCompleted = v.journeyCompleted;
    return `
      <div style="border:1px solid var(--border-glass);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-sm);background:rgba(255,255,255,0.02);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-xs);">
          <div>
            <span style="font-weight:600;color:var(--text-primary);">Visitor ${shortId(v.id)}</span>
            <span class="badge ${isCompleted ? 'badge-success' : 'badge-info'}" style="margin-left:6px;">
              ${isCompleted ? 'Completed ✓' : (v.journeyProgress ? `${v.journeyProgress}%` : 'In Progress')}
            </span>
          </div>
          <span style="font-size:0.8rem;color:var(--text-muted);">${formatTimestamp(v.createdAt)}</span>
        </div>

        <div style="display:flex;gap:var(--space-md);margin-top:var(--space-sm);font-size:0.85rem;flex-wrap:wrap;color:var(--text-secondary);">
          <div>📍 <strong>Location:</strong> ${v.locationPermission === 'granted' ? `${v.distanceKm ? `${Number(v.distanceKm).toFixed(1)} km away` : 'Shared'}` : (v.locationPermission || 'Not shared')}</div>
          <div>📷 <strong>Video:</strong> ${v.videoUrl ? 'Recorded ✓' : (v.cameraPermission || 'Not recorded')}</div>
        </div>

        <div style="display:flex;gap:var(--space-xs);margin-top:var(--space-sm);justify-content:flex-end;">
          ${v.latitude != null ? `<button class="btn btn-ghost btn-sm" onclick="window.__adminViewMap(${v.latitude}, ${v.longitude}, ${journey.myLatitude}, ${journey.myLongitude}, '${v.id}')">View Map</button>` : ''}
          ${v.videoUrl ? `<button class="btn btn-ghost btn-sm" onclick="window.__adminViewVideo('${v.videoUrl}')">Watch Video 🎬</button>` : ''}
          <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="window.__adminDeleteVisitor('${journey.id}', '${v.id}')">Delete</button>
        </div>
      </div>
    `;
  }

  // ─── GLOBAL ADMIN ACTION HANDLERS ──────────────────────────────────────────

  window.__adminCopyUrl = (url) => {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Journey link copied to clipboard! ✓', 'success');
    }).catch(() => {
      prompt('Copy this journey link:', url);
    });
  };

  window.__adminToggleActive = async (linkId, currentlyActive) => {
    try {
      await db.updateDoc('links', linkId, { active: !currentlyActive });
      showToast(`Journey ${currentlyActive ? 'deactivated' : 'activated'}. ✓`, 'success');
    } catch {
      showToast('Failed to toggle journey status.', 'error');
    }
  };

  window.__adminDeleteVisitor = async (linkId, visitorId) => {
    if (!confirm('Are you sure you want to delete this visitor record?')) return;
    try {
      await db.deleteDoc('visitors', visitorId);
      showToast('Visitor record deleted. ✓', 'success');
    } catch {
      showToast('Failed to delete visitor record.', 'error');
    }
  };

  window.__adminViewVideo = (videoUrl) => {
    const modal = document.getElementById('modal-video-overlay');
    const video = document.getElementById('modal-video');
    const msg = document.getElementById('modal-video-msg');
    if (modal && video) {
      video.src = videoUrl;
      video.style.display = '';
      if (msg) msg.textContent = '';
      modal.classList.add('open');
      video.play().catch(() => {});
    }
  };

  window.__adminViewMap = (vLat, vLng, aLat, aLng, visitorId) => {
    const modal = document.getElementById('modal-map-overlay');
    const mapEl = document.getElementById('modal-map');
    if (!modal || !mapEl || typeof L === 'undefined') return;

    modal.classList.add('open');
    if (adminState.modalMapInstance) {
      try { adminState.modalMapInstance.remove(); } catch {}
    }

    setTimeout(() => {
      try {
        const map = L.map('modal-map').setView([vLat, vLng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(map);

        L.marker([vLat, vLng]).addTo(map).bindPopup('Visitor Location').openPopup();
        if (aLat != null && aLng != null) {
          L.marker([aLat, aLng]).addTo(map).bindPopup('Destination (You) ❤️');
          const bounds = L.latLngBounds([[vLat, vLng], [aLat, aLng]]);
          map.fitBounds(bounds, { padding: [40, 40] });
        }
        adminState.modalMapInstance = map;
      } catch (err) {
        console.warn('Map initialization note:', err);
      }
    }, 200);
  };

  // ─── MODAL CLOSING ──────────────────────────────────────────────────────────

  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    const v = el.querySelector('video');
    const a = el.querySelector('audio');
    if (v) v.pause();
    if (a) a.pause();
    if (id === 'modal-map-overlay' && adminState.modalMapInstance) {
      try { adminState.modalMapInstance.remove(); } catch {}
      adminState.modalMapInstance = null;
    }
  }

  // ─── INITIALIZATION & EVENT ATTACHMENT ──────────────────────────────────────

  function initApp() {
    initStars();
    initPublicUrlSettings();

    // Attach Login Form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailEl = document.getElementById('login-email');
        const passEl = document.getElementById('login-password');
        const errEl = document.getElementById('login-error');
        const btn = document.getElementById('btn-login');

        const email = emailEl ? emailEl.value.trim() : '';
        const password = passEl ? passEl.value : '';

        if (!email || !password) {
          if (errEl) errEl.textContent = 'Please enter both email and password.';
          return;
        }

        if (errEl) errEl.textContent = '';
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

        try {
          const user = await auth.signIn(email, password);
          adminState.user = user;
          showDashboard();
        } catch (err) {
          console.warn('Login error:', err);
          if (errEl) errEl.textContent = err.message || 'Incorrect email or password.';
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'SIGN IN →'; }
        }
      });
    }

    // Attach Sign Up Button
    const btnSignup = document.getElementById('btn-signup');
    if (btnSignup) {
      btnSignup.addEventListener('click', async () => {
        const emailEl = document.getElementById('login-email');
        const passEl = document.getElementById('login-password');
        const errEl = document.getElementById('login-error');

        const email = emailEl ? emailEl.value.trim() : '';
        const password = passEl ? passEl.value : '';

        if (!email || !password) {
          if (errEl) errEl.textContent = 'Please enter email and password to create an account.';
          return;
        }

        if (errEl) errEl.textContent = '';
        btnSignup.disabled = true;
        btnSignup.textContent = 'Creating…';

        try {
          const res = await auth.signUp(email, password);
          if (res?.user) {
            adminState.user = res.user;
            showDashboard();
            showToast('Account created & logged in! ✓', 'success');
          }
        } catch (err) {
          if (errEl) errEl.textContent = err.message || 'Failed to sign up.';
        } finally {
          btnSignup.disabled = false;
          btnSignup.textContent = 'SIGN UP';
        }
      });
    }

    // Attach Instant Admin Button (1-Click Access)
    const btnInstant = document.getElementById('btn-instant-admin');
    if (btnInstant) {
      btnInstant.addEventListener('click', () => {
        const emailEl = document.getElementById('login-email');
        const localUser = {
          uid: 'aa4e274f-997d-4fbe-a9f8-1614df99e302',
          email: (emailEl && emailEl.value.trim()) || 'admin@local'
        };
        sessionStorage.setItem('alj_local_admin', JSON.stringify(localUser));
        adminState.user = localUser;
        showToast('Entered as Admin (Instant Mode) ✓', 'success');
        showDashboard();
      });
    }

    // Attach Logout Button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        await auth.signOut();
        showToast('Signed out.', 'info');
        showLogin();
      });
    }

    // Attach Create Journey Button
    const btnCreate = document.getElementById('btn-create-journey');
    if (btnCreate) {
      btnCreate.addEventListener('click', async () => {
        btnCreate.disabled = true;
        btnCreate.textContent = 'Getting GPS location…';

        const journeyUrl = buildJourneyUrl('preview');
        if (!journeyUrl) {
          showToast('Set the HTTPS Vercel URL before creating a share link.', 'error');
          btnCreate.disabled = false;
          btnCreate.textContent = '✦ CREATE NEW JOURNEY';
          return;
        }

        let adminLat = null;
        let adminLng = null;
        let adminAccuracy = null;

        try {
          if (navigator.geolocation) {
            const pos = await new Promise((res, rej) => {
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, enableHighAccuracy: true });
            });
            adminLat = pos.coords.latitude;
            adminLng = pos.coords.longitude;
            adminAccuracy = pos.coords.accuracy;
          }
        } catch {
          showToast('GPS unavailable. Journey created without destination marker.', 'info');
        }

        btnCreate.textContent = 'Creating journey…';
        const linkId = generateLinkId();
        const url = buildJourneyUrl(linkId);

        try {
          await db.setDoc('links', linkId, {
            linkId,
            createdBy: adminState.user?.uid || 'admin-uid',
            createdAt: new Date().toISOString(),
            active: true,
            myLatitude: adminLat,
            myLongitude: adminLng,
            myLocationAccuracy: adminAccuracy
          });

          const urlBox = document.getElementById('generated-link-url');
          const container = document.getElementById('link-generated-box');
          if (urlBox) urlBox.textContent = url;
          if (container) container.classList.add('visible');
          showToast('Journey created! ✓ Copy the link and share it.', 'success');
        } catch (e) {
          console.error('Create journey error:', e);
          showToast('Failed to create journey.', 'error');
        } finally {
          btnCreate.disabled = false;
          btnCreate.textContent = '✦ CREATE NEW JOURNEY';
        }
      });
    }

    // Attach Copy Link & Open Link Buttons
    const btnCopy = document.getElementById('btn-copy-link');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const urlBox = document.getElementById('generated-link-url');
        const url = urlBox ? urlBox.textContent : '';
        if (url) window.__adminCopyUrl(url);
      });
    }

    const btnOpen = document.getElementById('btn-open-link');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        const urlBox = document.getElementById('generated-link-url');
        const url = urlBox ? urlBox.textContent : '';
        if (url) window.open(url, '_blank');
      });
    }

    // Attach Refresh Button
    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        showToast('Refreshing data…', 'info');
        loadDashboard();
      });
    }

    // Attach Modal Close Buttons
    ['modal-map', 'modal-video'].forEach(m => {
      const btn = document.getElementById(`btn-close-${m}-modal`);
      if (btn) btn.addEventListener('click', () => closeModal(`${m}-overlay`));
      const overlay = document.getElementById(`${m}-overlay`);
      if (overlay) {
        overlay.addEventListener('click', (e) => {
          if (e.target.id === `${m}-overlay`) closeModal(`${m}-overlay`);
        });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ['modal-map-overlay', 'modal-video-overlay'].forEach(id => {
          const el = document.getElementById(id);
          if (el && el.classList.contains('open')) closeModal(id);
        });
      }
    });

    // Check Initial Auth State
    auth.onAuthStateChanged((user) => {
      if (user) {
        adminState.user = user;
        showDashboard();
      } else {
        adminState.user = null;
        showLogin();
      }
    });
  }

  // Self-execute reliably
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
