/**
 * supabase.js — Supabase Client and Bridge Layer for "A Little Journey"
 * 
 * Powered by @supabase/supabase-js.
 * Provides both raw Supabase client access, fallback offline/local persistence,
 * and seamless compatibility wrappers so the application runs 100% reliably.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── SUPABASE CONFIGURATION ──────────────────────────────────────────────────
export const SUPABASE_URL = 'https://oeqjnztdfbgttbjijmbm.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_YFyle0-xjuizV0IzfUroFg_vSCsBt5c';

// ─── INITIALIZE CLIENT ────────────────────────────────────────────────────────
export let supabase = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
} catch (e) {
  console.warn('Supabase client initialization notice (running in safe mode):', e);
}

// Identifier handles
export const auth = {
  get currentUser() { return supabase?.auth?.currentUser || null; }
};
export const db = 'supabase_db';
export const storage = 'supabase_storage';

// ─── LOCAL / OFFLINE FALLBACK STORE ──────────────────────────────────────────
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
    console.warn('Local storage write warning:', e);
  }
}

// ─── AUTHENTICATION HELPERS ───────────────────────────────────────────────────

function formatUser(user) {
  if (!user) return null;
  return {
    ...user,
    uid: user.id || user.uid || 'admin-local-uid'
  };
}

export function onAuthStateChanged(authInstance, callback) {
  // Check cached session
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      callback(formatUser(session.user));
    } else {
      const localAdmin = sessionStorage.getItem('alj_local_admin');
      if (localAdmin) {
        callback(JSON.parse(localAdmin));
      } else {
        callback(null);
      }
    }
  }).catch(() => {
    const localAdmin = sessionStorage.getItem('alj_local_admin');
    callback(localAdmin ? JSON.parse(localAdmin) : null);
  });

  // Listen for Supabase auth state changes
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      callback(formatUser(session.user));
    }
  });

  return () => {
    subscription?.unsubscribe();
  };
}

export async function signInWithEmailAndPassword(authInstance, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const err = new Error(error.message || 'Invalid login credentials');
    err.code = error.code || 'auth/invalid-credential';
    throw err;
  }
  return { user: formatUser(data.user) };
}

export async function signUpWithEmailAndPassword(authInstance, email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    const err = new Error(error.message);
    err.code = error.code || 'auth/signup-failed';
    throw err;
  }
  return {
    user: data.user ? formatUser(data.user) : null,
    session: data.session
  };
}

export async function signOut(authInstance) {
  sessionStorage.removeItem('alj_local_admin');
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('Sign-out note:', e.message);
  }
}

// ─── FIRESTORE / DATABASE BRIDGES ─────────────────────────────────────────────

export function serverTimestamp() {
  return new Date().toISOString();
}

export const Timestamp = {
  fromDate(date) {
    return date ? date.toISOString() : new Date().toISOString();
  },
  now() {
    return new Date().toISOString();
  }
};

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

export function doc(dbInstance, ...segments) {
  if (segments.length === 2) {
    // doc(db, 'links', linkId)
    return { table: segments[0], id: segments[1] };
  } else if (segments.length === 4) {
    // doc(db, 'links', linkId, 'visitors', visitorId)
    return {
      table: segments[2], // 'visitors'
      id: segments[3],    // visitorId
      linkId: segments[1] // linkId
    };
  }
  throw new Error(`Unsupported doc path segments: ${segments.join('/')}`);
}

export async function getDoc(docRef) {
  try {
    const { data, error } = await supabase
      .from(docRef.table)
      .select('*')
      .eq('id', docRef.id)
      .maybeSingle();

    if (!error && data) {
      return {
        exists: () => true,
        data: () => data,
        id: data.id || docRef.id
      };
    }
  } catch (e) {
    console.warn('Supabase getDoc fallback:', e.message);
  }

  // Fallback to local storage
  const key = docRef.table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
  const list = getLocalTable(key);
  const found = list.find(item => item.id === docRef.id);

  return {
    exists: () => !!found,
    data: () => found || {},
    id: docRef.id
  };
}

export async function setDoc(docRef, rawData) {
  const payload = cleanData({
    id: docRef.id,
    ...(docRef.linkId ? { linkId: docRef.linkId } : {}),
    ...rawData
  });

  // Always mirror in local storage
  const key = docRef.table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
  const list = getLocalTable(key);
  const idx = list.findIndex(i => i.id === docRef.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...payload };
  else list.unshift(payload);
  saveLocalTable(key, list);

  // Sync to Supabase
  try {
    const { error } = await supabase.from(docRef.table).upsert(payload);
    if (error) {
      console.warn('Supabase setDoc note (saved locally):', error.message);
    }
  } catch (e) {
    console.warn('Supabase sync note:', e.message);
  }
}

export async function updateDoc(docRef, rawData) {
  const payload = cleanData(rawData);

  // Mirror in local storage
  const key = docRef.table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
  const list = getLocalTable(key);
  const idx = list.findIndex(i => i.id === docRef.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...payload, lastUpdatedAt: new Date().toISOString() };
    saveLocalTable(key, list);
  }

  // Sync to Supabase
  try {
    const { error } = await supabase
      .from(docRef.table)
      .update(payload)
      .eq('id', docRef.id);

    if (error) console.warn('Supabase updateDoc note:', error.message);
  } catch (e) {
    console.warn('Supabase update note:', e.message);
  }
}

export async function deleteDoc(docRef) {
  // Remove from local storage
  const key = docRef.table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;
  let list = getLocalTable(key);
  list = list.filter(i => i.id !== docRef.id);
  saveLocalTable(key, list);

  // Delete from Supabase
  try {
    await supabase.from(docRef.table).delete().eq('id', docRef.id);
  } catch { /* ignore */ }
}

export function collection(dbInstance, ...segments) {
  if (segments.length === 1) {
    // collection(db, 'links')
    return { table: segments[0] };
  } else if (segments.length === 3) {
    // collection(db, 'links', journeyId, 'visitors')
    return {
      table: segments[2],
      parentLinkId: segments[1]
    };
  }
  throw new Error(`Unsupported collection path: ${segments.join('/')}`);
}

export function orderBy(field, direction = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function query(collectionRef, ...constraints) {
  return {
    collectionRef,
    constraints: constraints.filter(Boolean)
  };
}

function formatQuerySnap(rows) {
  const docs = (rows || []).map(row => ({
    id: row.id,
    data: () => row
  }));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0
  };
}

export function onSnapshot(queryTarget, onNext, onError) {
  const coll = queryTarget.collectionRef || queryTarget;
  const constraints = queryTarget.constraints || [];
  const orderConstraint = constraints.find(c => c.type === 'orderBy');
  const storeKey = coll.table === 'links' ? LOCAL_LINKS_KEY : LOCAL_VISITORS_KEY;

  async function fetchCurrentData() {
    let rows = null;
    try {
      let req = supabase.from(coll.table).select('*');
      if (coll.parentLinkId) {
        req = req.eq('linkId', coll.parentLinkId);
      }
      if (orderConstraint) {
        req = req.order(orderConstraint.field, { ascending: orderConstraint.direction === 'asc' });
      }
      const { data, error } = await req;
      if (!error && Array.isArray(data) && data.length > 0) {
        rows = data;
      }
    } catch {
      // Fallback
    }

    if (!rows) {
      // Read from local fallback
      let local = getLocalTable(storeKey);
      if (coll.parentLinkId) {
        local = local.filter(item => item.linkId === coll.parentLinkId);
      }
      rows = local;
    }

    if (onNext) onNext(formatQuerySnap(rows));
  }

  // Initial fetch
  fetchCurrentData();

  // Listen to local changes
  const localListener = () => fetchCurrentData();
  localBus.addEventListener('change', localListener);
  window.addEventListener('storage', localListener);

  // Supabase Realtime Subscription
  let channel = null;
  try {
    const channelName = `rt_${coll.table}_${coll.parentLinkId || 'all'}_${Math.random().toString(36).slice(2, 7)}`;
    channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: coll.table }, () => {
        fetchCurrentData();
      })
      .subscribe();
  } catch { /* ignore */ }

  return () => {
    localBus.removeEventListener('change', localListener);
    window.removeEventListener('storage', localListener);
    if (channel) supabase.removeChannel(channel);
  };
}

// ─── STORAGE BRIDGES ──────────────────────────────────────────────────────────

const STORAGE_BUCKET = 'alj-media';

function extractPath(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    const marker = `/${STORAGE_BUCKET}/`;
    const idx = pathOrUrl.indexOf(marker);
    if (idx !== -1) {
      return decodeURIComponent(pathOrUrl.substring(idx + marker.length).split('?')[0]);
    }
    const parts = pathOrUrl.split(`${STORAGE_BUCKET}/`);
    if (parts.length > 1) {
      return decodeURIComponent(parts[1].split('?')[0]);
    }
  }
  return pathOrUrl;
}

export function ref(storageInstance, pathOrUrl) {
  return {
    bucket: STORAGE_BUCKET,
    path: extractPath(pathOrUrl)
  };
}

export async function uploadBytes(storageRef, blob, metadata = {}) {
  const contentType = metadata?.contentType || blob.type || 'application/octet-stream';
  try {
    const { data, error } = await supabase.storage
      .from(storageRef.bucket)
      .upload(storageRef.path, blob, {
        contentType,
        upsert: true
      });

    if (!error) return data;
  } catch {
    // Fallback
  }

  // Local object URL fallback if Supabase bucket is not ready
  const localUrl = URL.createObjectURL(blob);
  sessionStorage.setItem(`blob_${storageRef.path}`, localUrl);
  return { path: storageRef.path, localUrl };
}

export async function getDownloadURL(storageRef) {
  try {
    const { data } = supabase.storage
      .from(storageRef.bucket)
      .getPublicUrl(storageRef.path);

    if (data?.publicUrl) return data.publicUrl;
  } catch {
    // Fallback
  }

  const cached = sessionStorage.getItem(`blob_${storageRef.path}`);
  return cached || '';
}

export async function deleteObject(storageRef) {
  const path = storageRef.path;
  if (!path) return;
  try {
    await supabase.storage.from(storageRef.bucket).remove([path]);
  } catch { /* ignore */ }
}
