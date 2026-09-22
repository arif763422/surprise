/**
 * admin.js — A Little Journey · Admin Dashboard
 * Handles authentication, journey creation with real-time admin GPS,
 * visitor data display, and all admin actions.
 */

import {
  auth, db, storage,
  signInWithEmailAndPassword,
  signUpWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, getDocs,
  serverTimestamp,
  ref, getDownloadURL, deleteObject
} from './supabase.js';

// ─── STATE ────────────────────────────────────────────────────────────────────
const adminState = {
  user:           null,
  journeysUnsub:  null,  // Firestore real-time listener unsubscribe
  visitorsUnsubs: [],    // visitor listener unsubscribes per journey
  allJourneys:    [],
  allVisitors:    [],
  modalMapInstance: null
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function generateLinkId(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function shortId(id) {
  return id ? `#${id.substring(0, 4).toUpperCase()}` : '#????';
}

// ─── STARS CANVAS ─────────────────────────────────────────────────────────────

function initStars() {
  const canvas = document.getElementById('stars-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  let stars = [];
  function createStars() {
    stars = Array.from({ length: 80 }, () => ({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height,
      r:  Math.random() * 1.2 + 0.2,
      a:  Math.random(),
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

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function initAuth() {
  onAuthStateChanged(auth, user => {
    if (user) {
      adminState.user = user;
      showDashboard();
    } else {
      adminState.user = null;
      showLogin();
    }
  });
}

function showLogin() {
  document.getElementById('admin-login').style.display = '';
  document.getElementById('admin-app').classList.remove('visible');
  teardownListeners();
}

function showDashboard() {
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-app').classList.add('visible');
  loadDashboard();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('btn-login');

  if (!email || !password) {
    errEl.textContent = 'Please enter both email and password.';
    return;
  }

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await signInWithEmailAndPassword(auth, email, password);
    if (res?.user) {
      adminState.user = res.user;
      showDashboard();
    }
  } catch (err) {
    console.warn('Sign-in error:', err);
    errEl.textContent = err.message || 'Incorrect email or password.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'SIGN IN →';
  }
});

// Sign-Up button handler
const btnSignup = document.getElementById('btn-signup');
if (btnSignup) {
  btnSignup.addEventListener('click', async () => {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');

    if (!email || !password) {
      errEl.textContent = 'Please enter email and password to create an account.';
      return;
    }

    errEl.textContent = '';
    btnSignup.disabled = true;
    btnSignup.textContent = 'Creating…';

    try {
      const res = await signUpWithEmailAndPassword(auth, email, password);
      if (res?.session) {
        adminState.user = res.user;
        showDashboard();
        showToast('Account created and signed in! ✓', 'success');
      } else {
        errEl.style.color = 'var(--secondary)';
        errEl.textContent = 'Account created! If confirmation is required, check your email or click Instant Access below.';
        showToast('Account created. Check email if confirmation needed.', 'info');
      }
    } catch (err) {
      console.warn('Sign-up error:', err);
      errEl.style.color = '';
      errEl.textContent = err.message || 'Failed to sign up.';
    } finally {
      btnSignup.disabled = false;
      btnSignup.textContent = 'SIGN UP';
    }
  });
}

// Instant Admin / Direct Mode handler (bypasses Auth form)
const btnInstant = document.getElementById('btn-instant-admin');
if (btnInstant) {
  btnInstant.addEventListener('click', () => {
    const localUser = {
      uid: 'aa4e274f-997d-4fbe-a9f8-1614df99e302',
      email: document.getElementById('login-email').value.trim() || 'admin@local'
    };
    sessionStorage.setItem('alj_local_admin', JSON.stringify(localUser));
    adminState.user = localUser;
    showToast('Entered as Admin (Instant Mode) ✓', 'success');
    showDashboard();
  });
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    await signOut(auth);
    showToast('Signed out.', 'info');
  } catch { /* ignore */ }
});

// ─── DASHBOARD LOAD ───────────────────────────────────────────────────────────

function loadDashboard() {
  teardownListeners();
  listenToJourneys();
}

function teardownListeners() {
  if (adminState.journeysUnsub) { adminState.journeysUnsub(); adminState.journeysUnsub = null; }
  adminState.visitorsUnsubs.forEach(u => u());
  adminState.visitorsUnsubs = [];
  adminState.allJourneys = [];
  adminState.allVisitors = [];
}

function listenToJourneys() {
  const q = query(collection(db, 'links'), orderBy('createdAt', 'desc'));

  adminState.journeysUnsub = onSnapshot(q, async (snap) => {
    adminState.allJourneys = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Refresh visitor listeners
    adminState.visitorsUnsubs.forEach(u => u());
    adminState.visitorsUnsubs = [];
    adminState.allVisitors = [];

    let pendingJourneys = adminState.allJourneys.length;
    if (pendingJourneys === 0) { renderDashboard(); return; }

    for (const journey of adminState.allJourneys) {
      const vq = query(
        collection(db, 'links', journey.id, 'visitors'),
        orderBy('createdAt', 'desc')
      );
      const unsub = onSnapshot(vq, (vSnap) => {
        const visitors = vSnap.docs.map(d => ({ id: d.id, linkId: journey.id, ...d.data() }));
        // Merge into allVisitors (replace existing for this linkId)
        adminState.allVisitors = [
          ...adminState.allVisitors.filter(v => v.linkId !== journey.id),
          ...visitors
        ];
        renderDashboard();
      });
      adminState.visitorsUnsubs.push(unsub);
    }
  }, (err) => {
    console.error('Firestore error:', err);
    showToast('Could not load journeys. Check your Supabase config.', 'error');
    renderDashboard();
  });
}

// ─── DASHBOARD RENDER ─────────────────────────────────────────────────────────

function renderDashboard() {
  updateStats();
  renderJourneysAndVisitors();
}

function updateStats() {
  const visitors  = adminState.allVisitors;
  document.getElementById('stat-journeys').textContent  = adminState.allJourneys.length;
  document.getElementById('stat-visitors').textContent  = visitors.length;
  document.getElementById('stat-locations').textContent = visitors.filter(v => v.locationPermission === 'granted').length;
  document.getElementById('stat-cameras').textContent   = visitors.filter(v => v.videoUrl).length;
  document.getElementById('stat-completed').textContent = visitors.filter(v => v.journeyCompleted).length;
}

function renderJourneysAndVisitors() {
  const container = document.getElementById('visitors-container');
  container.innerHTML = '';

  if (adminState.allJourneys.length === 0) {
    container.innerHTML = `
      <div class="text-center" style="padding:var(--space-2xl);color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:var(--space-md);">✦</div>
        <p>No journeys created yet. Create your first journey above.</p>
      </div>`;
    document.getElementById('visitors-count-badge').textContent = '0 journeys';
    return;
  }

  document.getElementById('visitors-count-badge').textContent =
    `${adminState.allJourneys.length} journeys · ${adminState.allVisitors.length} visitors`;

  for (const journey of adminState.allJourneys) {
    const journeyVisitors = adminState.allVisitors
      .filter(v => v.linkId === journey.id)
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const section = document.createElement('div');
    section.className = 'journey-section';
    section.innerHTML = `
      <div class="section-header" style="margin-bottom:var(--space-md);">
        <div>
          <div class="journey-link-label">Journey Link</div>
          <div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--purple-glow);word-break:break-all;">
            ${buildJourneyUrl(journey.id)}
          </div>
        </div>
        <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;align-items:center;">
          <span class="badge ${journey.active ? 'badge-green' : 'badge-muted'}">
            ${journey.active ? '● Active' : '● Inactive'}
          </span>
          <button
            class="btn btn-ghost"
            style="font-size:0.7rem;padding:0.4rem 0.8rem;min-height:32px;min-width:60px;"
            onclick="window.__adminCopyLink('${buildJourneyUrl(journey.id)}')"
            aria-label="Copy journey link"
          >Copy</button>
          <button
            class="btn ${journey.active ? 'btn-danger' : 'btn-ghost'}"
            style="font-size:0.7rem;padding:0.4rem 0.8rem;min-height:32px;min-width:80px;"
            onclick="window.__adminToggleJourney('${journey.id}', ${journey.active})"
            aria-label="${journey.active ? 'Deactivate' : 'Activate'} journey"
          >${journey.active ? 'Deactivate' : 'Activate'}</button>
        </div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:var(--space-lg);">
        Created: ${formatTimestamp(journey.createdAt)} ·
        ${journeyVisitors.length} visitor${journeyVisitors.length !== 1 ? 's' : ''}
        ${journey.myLatitude ? ` · Admin location: ${journey.myLatitude.toFixed(4)}, ${journey.myLongitude.toFixed(4)}` : ''}
      </div>
    `;

    const grid = document.createElement('div');
    grid.className = 'visitors-grid';

    if (journeyVisitors.length === 0) {
      grid.innerHTML = `
        <p style="color:var(--text-muted);font-size:0.85rem;padding:var(--space-md);">
          No visitors yet. Share the journey link to get started.
        </p>`;
    } else {
      journeyVisitors.forEach(v => {
        const card = buildVisitorCard(v, journey);
        grid.appendChild(card);
      });
    }

    section.appendChild(grid);
    container.appendChild(section);
  }
}

function buildJourneyUrl(linkId) {
  const SITE_URL = '';
  const configured = (localStorage.getItem('alj_public_site_url') || SITE_URL).trim().replace(/\/+$/, '');
  const origin = configured || window.location.origin;
  if (!/^https:\/\//i.test(origin) || /localhost|127\.0\.0\.1/i.test(origin)) return '';
  return `${origin}/?id=${encodeURIComponent(linkId)}`;
}

function buildVisitorCard(v, journey) {
  const card = document.createElement('div');
  card.className = 'visitor-card';

  const arrivalDisplay = v.arrivalTime
    ? new Date(v.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';

  const distDisplay = v.distanceKm
    ? `${Number(v.distanceKm).toFixed(1)} km`
    : '—';

  const progress = Number(v.journeyProgress) || 0;

  card.innerHTML = `
    <div class="visitor-card-header">
      <span class="visitor-id">${shortId(v.visitorId)}</span>
      <span class="visitor-time">${arrivalDisplay}</span>
    </div>

    <div class="visitor-stats-grid">
      <div class="visitor-stat">
        <span class="visitor-stat-label">Distance</span>
        <span class="visitor-stat-value">${distDisplay}</span>
      </div>
      <div class="visitor-stat">
        <span class="visitor-stat-label">Location</span>
        <span class="visitor-stat-value">
          <span class="badge ${v.locationPermission === 'granted' ? 'badge-green' : 'badge-muted'}">
            ${v.locationPermission === 'granted' ? 'Shared ✓' : (v.locationPermission || 'Pending')}
          </span>
        </span>
      </div>
      <div class="visitor-stat">
        <span class="visitor-stat-label">Camera</span>
        <span class="visitor-stat-value">
          <span class="badge ${v.videoUrl ? 'badge-green' : 'badge-muted'}">
            ${v.videoUrl ? 'Recorded ✓' : (v.cameraPermission === 'denied' ? 'Denied' : (v.cameraPermission || 'Pending'))}
          </span>
        </span>
      </div>
    </div>

    <div style="margin-bottom:var(--space-sm);">
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-muted);margin-bottom:4px;">
        <span>Journey Progress</span>
        <span>${progress}%${v.journeyCompleted ? ' · Completed ✓' : ''}</span>
      </div>
      <div class="progress-mini">
        <div class="progress-mini-fill" style="width:${progress}%"></div>
      </div>
    </div>

    <div class="visitor-actions">
      <button
        class="btn btn-ghost"
        ${!v.latitude ? 'disabled style="opacity:0.4;"' : ''}
        onclick="window.__adminViewMap('${v.linkId}', '${v.visitorId}')"
        aria-label="View visitor on map"
      >🗺 VIEW MAP</button>

      <button
        class="btn btn-ghost"
        ${!v.videoUrl ? 'disabled style="opacity:0.4;"' : ''}
        onclick="window.__adminPlayVideo('${v.videoUrl || ''}')"
        aria-label="Play visitor video"
      >▶ PLAY VIDEO</button>

      <button
        class="btn btn-danger"
        onclick="window.__adminDeleteVisitor('${v.linkId}', '${v.visitorId}', '${v.videoUrl || ''}', '${v.voiceUrl || ''}')"
        aria-label="Delete visitor data"
        style="flex-basis:100%;"
      >🗑 DELETE DATA</button>
    </div>
  `;

  return card;
}

// ─── CREATE JOURNEY ───────────────────────────────────────────────────────────

document.getElementById('btn-create-journey').addEventListener('click', () => {
  createNewJourney();
});

async function createNewJourney() {
  const btn = document.getElementById('btn-create-journey');
  btn.disabled = true;
  btn.textContent = 'Getting your location…';

  let adminLat = null, adminLng = null, adminAccuracy = null;

  try {
    const pos = await getAdminLocation();
    adminLat    = pos.coords.latitude;
    adminLng    = pos.coords.longitude;
    adminAccuracy = pos.coords.accuracy;
  } catch (err) {
    let msg = 'Location unavailable. Creating journey without your location.';
    if (err.code === 1) msg = 'Location permission denied. The journey will not have a destination marker.';
    showToast(msg, 'error');
  }

  btn.textContent = 'Creating journey…';

  const linkId = generateLinkId();
  const url    = buildJourneyUrl(linkId);

  if (!url) {
    showToast('Set the HTTPS Vercel URL before creating a share link.', 'error');
    btn.disabled = false;
    btn.textContent = '✦ CREATE NEW JOURNEY';
    return;
  }

  try {
    await setDoc(doc(db, 'links', linkId), {
      linkId,
      createdBy:       adminState.user.uid,
      createdAt:       serverTimestamp(),
      active:          true,
      myLatitude:      adminLat,
      myLongitude:     adminLng,
      myLocationAccuracy: adminAccuracy
    });

    document.getElementById('generated-link-url').textContent = url;
    document.getElementById('link-generated-box').classList.add('visible');
    showToast('Journey created! ✓ Copy the link and share it.', 'success');

  } catch (e) {
    console.error('Create journey error:', e);
    showToast('Failed to create journey. Check Supabase config.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ CREATE NEW JOURNEY';
  }
}

function getAdminLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });
  });
}

// ─── COPY LINK ────────────────────────────────────────────────────────────────

document.getElementById('btn-copy-link').addEventListener('click', () => {
  const url = document.getElementById('generated-link-url').textContent;
  if (url && url !== '—') window.__adminCopyLink(url);
});

document.getElementById('btn-open-link').addEventListener('click', () => {
  const url = document.getElementById('generated-link-url').textContent;
  if (url && url !== '—') window.open(url, '_blank');
});

window.__adminCopyLink = (url) => {
  navigator.clipboard.writeText(url)
    .then(() => showToast('Link copied to clipboard! ✓', 'success'))
    .catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Link copied! ✓', 'success');
    });
};

// ─── TOGGLE JOURNEY ACTIVE ────────────────────────────────────────────────────

window.__adminToggleJourney = async (linkId, currentlyActive) => {
  try {
    await updateDoc(doc(db, 'links', linkId), { active: !currentlyActive });
    showToast(`Journey ${currentlyActive ? 'deactivated' : 'activated'}.`, 'info');
  } catch (e) {
    showToast('Failed to update journey status.', 'error');
  }
};

// ─── REFRESH ──────────────────────────────────────────────────────────────────

document.getElementById('btn-refresh').addEventListener('click', () => {
  loadDashboard();
  showToast('Refreshed.', 'info');
});

// ─── MAP MODAL ────────────────────────────────────────────────────────────────

window.__adminViewMap = async (linkId, visitorId) => {
  const overlay = document.getElementById('modal-map-overlay');

  // Get data
  const journey = adminState.allJourneys.find(j => j.id === linkId);
  const visitor = adminState.allVisitors.find(v => v.id === visitorId && v.linkId === linkId);

  if (!visitor || !journey) { showToast('Could not load map data.', 'error'); return; }

  // Stats
  const statsEl = document.getElementById('modal-map-stats');
  statsEl.innerHTML = `
    <div class="visitor-stat">
      <span class="visitor-stat-label">Visitor Accuracy</span>
      <span class="visitor-stat-value">±${Math.round(visitor.locationAccuracy || 0)}m</span>
    </div>
    <div class="visitor-stat">
      <span class="visitor-stat-label">Straight Distance</span>
      <span class="visitor-stat-value">${visitor.distanceKm ? Number(visitor.distanceKm).toFixed(2) + ' km' : '—'}</span>
    </div>
  `;

  openModal('modal-map-overlay');

  // Give DOM a moment to paint
  setTimeout(() => {
    const mapEl = document.getElementById('modal-map');
    mapEl.innerHTML = '';

    if (adminState.modalMapInstance) {
      try { adminState.modalMapInstance.remove(); } catch {}
      adminState.modalMapInstance = null;
    }

    const map = L.map(mapEl);
    adminState.modalMapInstance = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);

    const visIcon = L.divIcon({
      className: '',
      html: '<div class="marker-visitor">📍</div>',
      iconSize: [40,40], iconAnchor: [20,20]
    });
    const admIcon = L.divIcon({
      className: '',
      html: '<div class="marker-admin">❤️</div>',
      iconSize: [40,40], iconAnchor: [20,20]
    });

    const markers = [];

    if (visitor.latitude && visitor.longitude) {
      const vm = L.marker([visitor.latitude, visitor.longitude], { icon: visIcon })
        .addTo(map)
        .bindPopup('<b>📍 Visitor</b>');
      markers.push(vm);
    }

    if (journey.myLatitude && journey.myLongitude) {
      const am = L.marker([journey.myLatitude, journey.myLongitude], { icon: admIcon })
        .addTo(map)
        .bindPopup('<b>❤️ My Location</b>');
      markers.push(am);
    }

    if (visitor.latitude && visitor.longitude && journey.myLatitude && journey.myLongitude) {
      L.polyline(
        [[visitor.latitude, visitor.longitude],[journey.myLatitude, journey.myLongitude]],
        { color: '#8b5cf6', weight: 2, dashArray: '6,6', opacity: 0.8 }
      ).addTo(map);
    }

    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.3));
    } else {
      map.setView([20, 77], 4);
    }

    map.invalidateSize();
  }, 200);
};

// ─── VIDEO MODAL ──────────────────────────────────────────────────────────────

window.__adminPlayVideo = (url) => {
  const video  = document.getElementById('modal-video');
  const msgEl  = document.getElementById('modal-video-msg');

  if (!url) {
    video.style.display = 'none';
    msgEl.textContent   = 'No video available for this visitor.';
  } else {
    video.style.display = '';
    video.src           = url;
    msgEl.textContent   = '';
  }

  openModal('modal-video-overlay');
};

// ─── VOICE MODAL ──────────────────────────────────────────────────────────────

window.__adminPlayVoice = (url) => {
  const audio = document.getElementById('modal-audio');
  if (url) audio.src = url;
  openModal('modal-voice-overlay');
};

// ─── JOURNEY TIMELINE MODAL ───────────────────────────────────────────────────

window.__adminViewJourney = (linkId, visitorId) => {
  const visitor = adminState.allVisitors.find(v => v.id === visitorId && v.linkId === linkId);
  if (!visitor) return;

  document.getElementById('modal-journey-title').textContent =
    `Journey Timeline — ${shortId(visitor.visitorId)}`;

  const steps = [
    {
      icon: '✓', label: 'Opened journey',
      detail: visitor.arrivalTime ? `At ${new Date(visitor.arrivalTime).toLocaleString()}` : '—',
      done: true
    },
    {
      icon: visitor.locationPermission === 'granted' ? '✓' : '–',
      label: 'Location requested',
      detail: `Permission: ${visitor.locationPermission || 'pending'}`,
      done: visitor.locationPermission !== 'pending'
    },
    {
      icon: visitor.locationPermission === 'granted' ? '✓' : '×',
      label: visitor.locationPermission === 'granted' ? 'Location granted' : 'Location denied',
      detail: visitor.latitude ? `±${Math.round(visitor.locationAccuracy || 0)}m accuracy` : '',
      done: visitor.locationPermission === 'granted',
      skipped: visitor.locationPermission === 'denied'
    },
    {
      icon: visitor.distanceKm ? '✓' : '–',
      label: visitor.distanceKm ? 'Distance revealed' : 'Distance not calculated',
      detail: visitor.distanceKm ? `${Number(visitor.distanceKm).toFixed(1)} km (straight line)` : '',
      done: !!visitor.distanceKm
    },
    {
      icon: (visitor.choiceOne || visitor.choiceTwo) ? '✓' : '–',
      label: 'Choices made',
      detail: [visitor.choiceOne, visitor.choiceTwo].filter(Boolean).join(' · ') || '—',
      done: !!(visitor.choiceOne || visitor.choiceTwo)
    },
    {
      icon: visitor.cameraPermission && visitor.cameraPermission !== 'pending' ? '✓' : '–',
      label: 'Camera requested',
      detail: `Permission: ${visitor.cameraPermission || 'pending'}`,
      done: visitor.cameraPermission && visitor.cameraPermission !== 'pending'
    },
    {
      icon: visitor.videoUrl ? '✓' : (visitor.cameraPermission === 'denied' ? '×' : '–'),
      label: visitor.videoUrl ? 'Video recorded' : 'No video captured',
      detail: visitor.videoUrl ? 'Available in dashboard' : '',
      done: !!visitor.videoUrl,
      skipped: !visitor.videoUrl
    },
    {
      icon: visitor.voiceUrl ? '✓' : '–',
      label: visitor.voiceUrl ? 'Voice message left' : 'No voice message',
      detail: visitor.voiceUrl ? 'Audio available' : `Mic: ${visitor.microphonePermission || '—'}`,
      done: !!visitor.voiceUrl,
      skipped: !visitor.voiceUrl
    },
    {
      icon: visitor.journeyCompleted ? '✓' : '–',
      label: visitor.journeyCompleted ? 'Journey completed' : 'Journey in progress',
      detail: `Progress: ${visitor.journeyProgress || 0}%`,
      done: visitor.journeyCompleted
    }
  ];

  const container = document.getElementById('modal-timeline-content');
  container.innerHTML = '';

  steps.forEach(step => {
    const el = document.createElement('div');
    el.className = `modal-timeline-item ${step.done ? 'completed' : ''} ${step.skipped && !step.done ? 'skipped' : ''}`;
    el.innerHTML = `
      <span class="modal-timeline-icon">${step.icon}</span>
      <div class="modal-timeline-text">
        <div class="modal-timeline-label">${step.label}</div>
        ${step.detail ? `<div class="modal-timeline-detail">${step.detail}</div>` : ''}
      </div>
    `;
    container.appendChild(el);
  });

  openModal('modal-journey-overlay');
};

// ─── DELETE VISITOR ───────────────────────────────────────────────────────────

window.__adminDeleteVisitor = async (linkId, visitorId, videoUrl, voiceUrl) => {
  const confirmed = window.confirm(
    'Are you sure you want to permanently delete this visitor\'s data? This action cannot be undone.'
  );
  if (!confirmed) return;

  try {
    // Delete Firestore doc
    await deleteDoc(doc(db, 'links', linkId, 'visitors', visitorId));

    // Delete video from storage
    if (videoUrl && videoUrl !== 'undefined' && videoUrl !== '') {
      try {
        const vidRef = ref(storage, decodeURIComponent(new URL(videoUrl).pathname.split('/o/')[1].split('?')[0]));
        await deleteObject(vidRef);
      } catch { /* file may not exist */ }
    }

    // Delete voice from storage
    if (voiceUrl && voiceUrl !== 'undefined' && voiceUrl !== '') {
      try {
        const voiceRef = ref(storage, decodeURIComponent(new URL(voiceUrl).pathname.split('/o/')[1].split('?')[0]));
        await deleteObject(voiceRef);
      } catch { /* file may not exist */ }
    }

    showToast('Visitor data deleted. ✓', 'success');
  } catch (e) {
    console.error('Delete error:', e);
    showToast('Failed to delete visitor data.', 'error');
  }
};

// ─── MODAL HELPERS ────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.remove('open');

  // Pause any media
  const video = overlay.querySelector('video');
  const audio = overlay.querySelector('audio');
  if (video) video.pause();
  if (audio) audio.pause();

  // Clean up map
  if (id === 'modal-map-overlay' && adminState.modalMapInstance) {
    try { adminState.modalMapInstance.remove(); } catch {}
    adminState.modalMapInstance = null;
  }
}

// Modal close buttons
document.getElementById('btn-close-map-modal').addEventListener('click',     () => closeModal('modal-map-overlay'));
document.getElementById('btn-close-video-modal').addEventListener('click',   () => closeModal('modal-video-overlay'));
document.getElementById('btn-close-voice-modal').addEventListener('click',   () => closeModal('modal-voice-overlay'));
document.getElementById('btn-close-journey-modal').addEventListener('click', () => closeModal('modal-journey-overlay'));

// Close on overlay click
['modal-map-overlay','modal-video-overlay','modal-voice-overlay','modal-journey-overlay'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target.id === id) closeModal(id);
  });
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ['modal-map-overlay','modal-video-overlay','modal-voice-overlay','modal-journey-overlay'].forEach(id => {
      if (document.getElementById(id).classList.contains('open')) closeModal(id);
    });
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initStars();
  initAuth();
});
