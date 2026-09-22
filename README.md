# ✦ A Little Journey

> A cinematic, consent-based interactive experience made for one person.

A Little Journey is a private, mobile-first web experience where the creator/admin sets up a unique journey link and shares it with someone special. The visitor moves through five focused screens: welcome, location consent, distance/map, the reveal question, and the final reveal. Location and camera recording are optional and consent-based.

---

## ✦ Quick Preview

```
Admin  →  Opens admin.html  →  Signs in  →  Creates Journey  →  Copies Link
Visitor →  Opens Link (?id=...) → Travels 5 screens  →  Admin views location/video results live
```

---

## ✦ Backend Setup (Supabase — Recommended)

The project is configured to use **Supabase** for database, realtime subscriptions, authentication, and media storage.

### Step 1 — Create a Supabase Project
1. Go to [https://supabase.com/](https://supabase.com/) and sign in.
2. Click **New Project** and name it (e.g. `a-little-journey`).
3. Set a strong database password and select a region close to you.

### Step 2 — Run the Database Schema & Storage Setup
1. In your Supabase dashboard, click on **SQL Editor** from the left sidebar.
2. Click **New query**.
3. Open `supabase.sql` from this repository, copy its entire contents, paste it into the editor, and click **Run**.
4. This script automatically:
   - Creates the `links` table
   - Creates the `visitors` table
   - Enables Realtime subscriptions for live dashboard updates
   - Configures Row Level Security (RLS) policies
   - Creates the `alj-media` storage bucket and access rules

### Step 3 — Create Your Admin User
1. In your Supabase dashboard, go to **Authentication → Users**.
2. Click **Add user** → **Create user**.
3. Enter your email and password (e.g. `admin@example.com` and your password).
4. This email/password is what you will enter on `admin.html` to log in.

### Step 4 — Enter Your Supabase Credentials
1. In your Supabase dashboard, go to **Project Settings (gear icon) → API**.
2. Copy your **Project URL** and **anon public API Key**.
3. Open `supabase.js` in your project folder and update lines 13–14:
```javascript
export const SUPABASE_URL = 'https://your-project-ref.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...your-anon-key...';
```

That's it! Your Supabase backend is fully operational.

---

## ✦ Alternative: Firebase Setup

If you prefer using Firebase instead of Supabase:
1. Follow the Firebase console instructions to create Firestore, Storage, and Email Auth.
2. In `app.js` and `admin.js`, change the import at the top from `./supabase.js` to `./firebase.js`.
3. Fill your credentials in `firebase.js`.
4. Deploy security rules from `firestore.rules` and `storage.rules`.

---

## ✦ How the Unique Link System Works

When you click **✦ CREATE NEW JOURNEY** in the admin dashboard:

1. Your browser requests your current location (used as the destination marker on the visitor's map).
2. A random 12-character Journey ID is generated (e.g. `Xk92Pz81LmQv`).
3. A record is created in the database storing your coordinates and journey status.
4. A unique shareable URL is generated: `https://your-domain.com/index.html?id=Xk92Pz81LmQv`.
5. Share this link directly with your recipient.

---

## ✦ Visitor Journey — 5 Screens

| Screen | Description |
|--------|-------------|
| 01 | Welcome |
| 02 | Location consent |
| 03 | Distance counter and Leaflet map |
| 04 | Reveal question and camera consent |
| 05 | IT WAS YOU reveal and background upload |

## ✦ Make a Link Work on Every Phone

The admin dashboard cannot share a `file://` or `localhost` link with another phone. It needs a public HTTPS website URL.

### Option A: Vercel
1. Import this folder into a Vercel project, or run `npx vercel` from this folder.
2. Copy the resulting `https://...vercel.app` URL.
3. Open `admin.html`, paste it into **Public Website URL / Domain**, and click **SAVE URL**.
4. Create a journey. Copy the generated HTTPS link or scan its QR code.

### Option B: Temporary phone test
1. Start `share_to_phone.bat` from this folder.
2. Keep both terminal windows open. The LocalTunnel output provides an `https://...loca.lt` URL.
3. Paste that URL into the dashboard public URL setting, then create a journey.

Camera and geolocation require HTTPS on real phones. A public host is required; a LAN `http://192.168...` address is not sufficient.

## ✦ Production Deployment Checklist

### STEP 1
Open the `A-Little-Journey` project folder in VS Code.

### STEP 2
Create a new GitHub repository. Do not commit passwords, service-role keys, or other secrets.

### STEP 3
Commit and push the project to GitHub.

### STEP 4
Open [Vercel](https://vercel.com/) and sign in with GitHub.

### STEP 5
Import the GitHub repository into Vercel. Select the project folder if the repository contains more than one folder.

### STEP 6
Open Vercel Dashboard -> Project -> Settings -> Environment Variables only if you move configuration out of the checked-in frontend files. The current frontend uses the existing Supabase URL and publishable anon key, which are browser-safe. Never add a Supabase `service_role` key to frontend code.

### STEP 7
Deploy the project.

### STEP 8
Copy the production HTTPS URL assigned by Vercel, for example your own `https://your-project.vercel.app` URL.

### STEP 9
In Supabase Dashboard -> Authentication -> URL Configuration, add the real Vercel URL as the Site URL and add it to Redirect URLs if authentication redirects are enabled. Do not enter the example domain from this guide.

### STEP 10
Open `https://your-real-domain.vercel.app/admin.html` using the real URL.

### STEP 11
Log in and click **CREATE NEW JOURNEY**. The admin browser requests the current admin location and saves it on that journey record; it is not hardcoded.

### STEP 12
Copy the generated link. On a deployed HTTPS dashboard it uses the Vercel production origin automatically. On local testing, paste the real HTTPS domain into **Public Website URL / Domain** before creating a link.

### STEP 13
Open the copied link from an Android phone. The `id` query parameter is preserved on direct navigation and refresh.

### STEP 14
Test location permission, the map, the distance, camera permission, the five-second recording, Supabase Storage upload, and the visitor record in the admin dashboard. Repeat on iPhone Safari when available.

### Configuration and security notes

- `supabase.js` contains the existing Supabase project URL and publishable anon key. These are intended for browser use; database and storage policies remain the security boundary.
- No `service_role` key is present in the frontend files. If one is ever found there, remove it immediately and rotate it in Supabase.
- The existing `alj-media` bucket and `captures/{linkId}/{visitorId}.webm` upload path are preserved.
- The SQL file currently configures `alj-media` as public because the existing dashboard stores playable public URLs. If you change that bucket to private, replace public URLs with authenticated signed URLs before deploying.
- Camera and geolocation are requested only after an explicit visitor button action. The stream is stopped after recording, and unsupported or denied permissions complete the reveal without exposing raw browser errors.

### Developer diagnostics

On a deployed visitor page, open the browser console and run:

```js
window.__aljDiagnostics()
```

It reports the current origin, URL, journey ID, HTTPS status, Supabase initialization, and browser support flags without returning keys or visitor coordinates.

---

## ✦ Privacy & Security Architecture

Modern mobile operating systems (iOS and Android) and web standards enforce strict security boundaries to protect users:
- **No Stealth Sensor Access**: Web browsers cannot activate cameras, microphones, or GPS secretly or in the background. Explicit user gestures and visible OS prompts are strictly enforced by hardware and operating systems.
- **Transparent Consent Flow**: Every sensitive sensor is preceded by a clear explanation and requires explicit permission (`ALLOW LOCATION`, `ALLOW CAMERA`, `RECORD`).
- **Data Minimization**: No contacts, passwords, files, or background telemetry are collected.
- **Row Level Security (RLS)**: Data access is constrained by database-level security policies.

---

## ✦ Testing Locally and On Mobile

### Local Testing:
Run any static file server in this folder, for example:
```powershell
python -m http.server 8080
```
Then visit:
- Admin Dashboard: `http://localhost:8080/admin.html`
- Visitor Screen: `http://localhost:8080/index.html?id=YOUR_LINK_ID`

### Testing on Real Mobile Devices:
> **Important:** Web browsers restrict camera, microphone, and geolocation APIs to **HTTPS** origins. Testing over plain `http://` on other devices on a LAN will block camera and location.
> To test on mobile devices, deploy the folder to an HTTPS host (such as Supabase Hosting, Cloudflare Pages, Vercel, Netlify, or Firebase Hosting).

---

## ✦ Project File Reference

| File | Purpose |
|------|---------|
| `index.html` | Visitor journey (23 interactive screens) |
| `admin.html` | Admin login + live dashboard |
| `supabase.js` | Supabase SDK config, client, and realtime bridge |
| `supabase.sql` | 1-click database schema, RLS, and storage script |
| `app.js` | Visitor journey engine |
| `admin.js` | Admin dashboard engine |
| `style.css` | Complete cinematic design system |
| `firebase.js` | Firebase SDK configuration (legacy alternative) |
| `firestore.rules` | Firebase Firestore security rules |
| `storage.rules` | Firebase Storage security rules |
| `assets/favicon.svg` | Site favicon |
