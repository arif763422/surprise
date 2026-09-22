// firebase.js — Firebase Web SDK 12.17.1 configuration
// Replace the placeholder values below with your actual Firebase project configuration.
// You can find these values in your Firebase Console > Project Settings > General > Your apps

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";

// ─── FIREBASE CONFIGURATION ───────────────────────────────────────────────────
// Replace these placeholders with your actual Firebase project values.
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─── INITIALIZE FIREBASE ──────────────────────────────────────────────────────
const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  // Core
  app, auth, db, storage,

  // Auth
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,

  // Firestore
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, onSnapshot, getDocs,
  serverTimestamp, Timestamp,

  // Storage
  ref, uploadBytes, getDownloadURL, deleteObject
};
