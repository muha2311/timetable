# CS Faculty Timetable Management

React + TypeScript + Vite + Tailwind, Firebase (Auth + Firestore), static deploy on Cloudflare Pages.

## Local development
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Firebase web app values.
3. `npm run dev` (http://localhost:5173)
4. `npm run typecheck` and `npm run build` before deploying.

## Firebase setup (manual)
1. Create a project at https://console.firebase.google.com
2. Add a Web app and copy its config into `.env.local`.
3. Authentication > Sign-in method > enable Email/Password; add your user under Users.
4. Firestore Database > Create database (pick a region; it cannot be changed later).
5. Edit `firestore.rules`, replace the placeholder email with yours, paste into Firestore > Rules, Publish.
   Note: the rule requires a verified email. Verify your user via the Auth console or a verification email.

## Cloudflare Pages
Build command `npm run build`, output directory `dist`, add the `VITE_FIREBASE_*` variables,
then add your `*.pages.dev` domain to Firebase Auth > Settings > Authorized domains.

Status: Phase 1 scaffold. Feature pages arrive in Phase 3.

## Seeding initial data
- Default academic data (4 levels, 10/8/4/1 sections): `scripts/seed/academic.mjs`.
- Your faculty and classrooms: fill `scripts/seed/records.mjs` (both lists are empty; the file documents the row format).
- Credentials: uses your normal Firebase admin user (the one in Authentication) through the client SDK. No service
  account or private key is needed or used. Put `VITE_FIREBASE_*` in `.env.local` (git-ignored). Email/password are
  prompted, or set `SEED_EMAIL`/`SEED_PASSWORD` in your shell for one run.
- Commands: `npm run seed -- --dry-run` (read-only preview), then `npm run seed`. It asks you to type the Firebase
  project ID before writing (`-- --yes` skips). It is create-only: existing documents are skipped, never overwritten or deleted.
- Tests: `npm test` (Node 22.18+; older Node 22 versions work with the flag already in the script).

## Timetable feature
`/timetable`: grid and list views per level, add/edit/duplicate/delete sessions, conflict warnings.
Data: `timetableEntries` (one document per session; references `facultyMembers`, `classrooms`, `sections` by ID).
Courses are stored as plain `courseName` text on each entry (suggestions come from existing entries); a `courses`
collection can replace this later. Instructors and rooms can be added from inside the session form.
No new Firestore rules are needed: the existing admin-only rule already covers `timetableEntries`.

## Courses, students, PDF export
- **Courses** (`courses`): `{ name, level (1-4), semester, createdAt, updatedAt }`, ID `L{level}_{semester}_{slug(name)}` (e.g. `L1_fall_math-1`).
  The 23 Fall courses are in `scripts/seed/academic.mjs` and seeded by `npm run seed` (create-only). Names stay English in the
  database; Arabic display names are `course.<slug>` keys in `src/locales`. Timetable entries still store `courseName` (unchanged schema).
- **Students** (`students`) is prepared and empty. Schema: `{ fullName, academicId (registration no.), level, sectionId, academicYear, status, createdAt, updatedAt }`,
  ID = `slug(academicId)` (so one registration number = one student). `status` is a placeholder (`active`/`inactive`) until you define the real rules.
  Data access: `src/repositories/studentsRepo.ts` (`listStudents`, `createStudent`, which checks the section belongs to the level). No UI or seed data yet.
- **PDF**: on the Timetable page click *Export to PDF*. It opens the browser print dialog with a print-ready A4 landscape page for the current
  year, semester, level and language; choose *Save as PDF* as the destination. This needs no library and renders Arabic/RTL correctly; the trade-off is
  that the final save step is the browser's dialog.

## Exam management
- Route `/exam-schedule`. A schedule is the triple (academic year, semester, exam type); `examSchedules/{year}_{semester}_{type}` holds a `version` counter.
- `exams/{scheduleId}__{courseId}`: `date`, `startMinutes`, `endMinutes`, `roomIds`, `roomCapacities` (snapshot), `allocation` ({roomId: [studentIds]}), `studentCount`, `notes`. One exam per course per schedule by construction.
- `settings/institution`: names/header/footer (EN + AR) and two logos (resized to max 256 px, stored as data URLs, under ~300 KB each). Edit them in **Settings**.
- Rules enforced by `validateExam()` (same function in the form and in the final save): combined capacity of the chosen rooms >= unique enrolled students (rooms without a valid capacity block saving),
  no overlapping booking of a room (any schedule), no student with two exams on the same date within the schedule (reuses `analyze()` of the Exam Conflict Checker), data must be verifiable.
- Final save: re-reads exams, room capacities and enrollments, re-validates, then commits in a Firestore transaction that checks the schedule `version`; a concurrent save forces re-validation.
- No new Firestore indexes (equality filters only). Existing admin-only security rules already cover the new collections.
- PDF: uses the browser print dialog (choose "Save as PDF"). Page numbers and the footer use CSS page margin boxes (Chrome/Edge 131+).

## Users, roles and the secure API (Cloudflare Pages Functions)
**Roles** (`users/{authUid}`: `uid, fullName, email, role, isActive, createdAt, updatedAt, lastLoginAt, createdBy`):
- `SUPER_ADMIN`: everything, including Users, Settings (branding) and reference data (faculty, classrooms, courses, sections).
- `USER`: read everything; day-to-day work (students, enrollments, imports, timetable, exams); cannot change reference data/settings or touch users.
- Enforced in `firestore.rules` (reads the caller's profile on every request; a disabled account is cut off immediately) and in `functions/` (server). Hiding menu items is only cosmetic.
- Browsers can never write `role`/`isActive`; they can only stamp their own `lastLoginAt`. The only self-created profile is the ORIGINAL Super Admin (rules check the bootstrap email).

**Why Pages Functions:** the app is a static Cloudflare Pages site. Creating Auth accounts needs privileged credentials, so it runs in `functions/api/*` on the same Pages project (no extra backend). Firebase's Admin SDK needs Node, so the functions call Google's REST APIs
(Identity Toolkit + Firestore) with the service account kept in a Cloudflare **secret**. Each request: Firebase ID token verified by Google -> role read from Firestore with server credentials -> must be an active SUPER_ADMIN.
Endpoints (all POST): `/api/users` (create), `/api/users/update` ({uid, role?, isActive?}), `/api/users/link` ({uid}). Accounts are created without a password; the admin gets a one-time password-setup link (or sends Firebase's setup email). The last active Super Admin cannot be disabled or demoted. If saving the profile fails, the Auth account is deleted again.

**Deployment checklist (Cloudflare Pages)**
1. Firebase Console > Project settings > Service accounts > *Generate new private key* (keep the file private; never paste it anywhere).
2. Cloudflare Pages > your project > Settings > Variables and Secrets (Production, and Preview if used):
   `FIREBASE_PROJECT_ID` (text), `FIREBASE_WEB_API_KEY` (text, same as VITE_FIREBASE_API_KEY), `FIREBASE_SERVICE_ACCOUNT` (**Secret**: the whole JSON). Keep the existing `VITE_FIREBASE_*` build variables.
3. Edit `firestore.rules`: replace `REPLACE_WITH_YOUR_EMAIL@example.com` with your existing admin email, then publish (Firebase Console > Firestore > Rules).
4. Deploy (git push). `functions/` is picked up automatically. Build command `npm run build`, output `dist`.
5. Sign in once with your existing admin account: the app creates its Super Admin profile (allowed only for the bootstrap email). Open **User Management**.
6. Create the extra Super Admin and the two Users there; send each the setup link (or "Send setup email"). Firebase's default email sender works without extra configuration; a custom template/provider is optional (Authentication > Templates).
7. Firebase Console > Authentication > Settings > Authorized domains: your `*.pages.dev`/custom domain. The Identity Toolkit API is already enabled by Firebase Authentication.
8. Run the seed only after step 5 (the seed signs in as your Super Admin).

**Local development with the API:** `npm run build`, then `npx wrangler pages dev dist` (reads `.dev.vars`; copy `.dev.vars.example`) and `npm run dev` in another terminal (Vite proxies `/api` to port 8788). `npx` downloads wrangler on demand; it is not added to package.json.

## Dashboard
Counts use Firestore aggregation queries (no documents downloaded); results are cached for 5 minutes, cleared by imports/edits/Refresh. Student counts are unique student records; enrollment counts are unique (student, course) records.
Recent activity comes from the append-only `activityLog` collection (imports, timetable and exam changes, user changes).

## PDF branding
Academic Timetable (grid and list) and Exam Schedule PDFs use one template (`src/features/exams/examPdf.ts`) and one configuration (`settings/institution`, edited in Settings).

## Offline support and synchronization
- **PWA:** `public/manifest.webmanifest` + `public/sw.js` + icons. The service worker caches only the app shell and built static files (and public Google Fonts). Firebase/Google API calls, `/api/*` and non-GET requests are never cached. Navigations are network-first (a new deployment is picked up at once); the cached shell is the offline fallback. The app is installable (Chrome/Edge "Install app").
- **Firestore persistence** (`src/services/firebase/init.ts`): IndexedDB cache shared by tabs (`persistentMultipleTabManager`), falling back to memory when unavailable. Records opened while online can be read offline; records never opened online are not available (empty, not an error).
- **Two kinds of writes**
  1. *Plain edits* (faculty incl. availability flag, classrooms, administrative staff, student level/section, settings): written to the local cache immediately and sent by Firestore when the connection returns (`settle()` in `services/offline/native.ts`, so screens never hang offline). Last write wins; these are reference data.
  2. *Critical operations that need fresh validation* (timetable sessions, exams, invigilator assignments): online they run immediately; offline they go to a **durable outbox** (IndexedDB, `domain/outbox.ts`) and are replayed through the same authoritative functions on reconnect. Each operation has one id, used for the first attempt and every replay (idempotent: new documents get client-made ids and store `lastOpId`). Repeated offline edits of one record collapse into one operation. Retries use exponential backoff (1 s ... 60 s, 8 attempts) and keep order. One tab processes at a time (Web Locks). Operations only run under the account that made them.
- **Conflicts:** an offline edit remembers the record's `updatedAt` when it began. If someone changed the record meanwhile, the replay stops with *modified elsewhere* (nothing is overwritten). Rule violations discovered on replay (student/room/instructor conflicts, capacity, an invigilator no longer free) also stop as conflicts. The sync indicator -> Synchronization lists them with Retry / Apply mine anyway (only for "modified elsewhere") / Discard. Permission-denied results are kept as failed, never applied.
- **Needs a connection (disabled offline, with a message):** student import, user management, dashboard counts, Exam Conflict Checker, level correction, deleting faculty/classrooms (usage must be verified), password setup.
- **Indicator** (header): Synced / Offline / Syncing / n pending / Sync failed / Conflict. "Synced" is shown only when the outbox is empty and Firestore reports no unacknowledged writes (`waitForPendingWrites`). Signing out clears the local cache unless changes are still waiting (also: Synchronization -> Clear offline data).

## Exam invigilators (`/invigilation`)
- Policy (fixed): **required = occupied rooms x 2**, independent of student numbers. Occupied = rooms holding students in the saved distribution (all selected rooms if no distribution was saved).
- Data: teaching assistants are the existing `facultyMembers` with role *Teaching Assistant* (new optional `isActive`, missing = active; edit it on the Faculty page). Administrative staff: new `adminStaff` collection (`fullName`, `isActive`, `notes`). Assignments: `invigilations/{examId}` -> `assignments: { roomId: [slot1, slot2] }`, each slot `{ personId, category: "TA"|"ADMIN", assignedAt, assignedBy }`; `meta/invigilation.version` serializes saves.
- Rules enforced identically in the screen and the final save: only active, existing people; nobody twice in one exam; nobody in two exams whose real time intervals overlap (09-11 vs 11-13 is fine); administrative staff only when no available teaching assistant is left for that exam; at most two per room; no assignments to unoccupied rooms. A room is *complete* only with exactly two valid invigilators; invalid assignments are rejected on save, incomplete ones are allowed. Shortage = required - valid assigned.
- Auto-assign keeps valid assignments, clears invalid ones, fills first positions of all rooms before second positions, teaching assistants (lowest workload first) before administrative staff.
- Report: Invigilation Report PDF (same branded template) with summary totals.

## Deployment / testing checklist (offline + invigilators)
1. Publish `firestore.rules` (new: `adminStaff`, `invigilations`, `meta`). No new indexes are needed.
2. Deploy as before (`public/` files are served as-is; `_headers` keeps `sw.js` uncached). Use HTTPS (Cloudflare Pages does).
3. Offline test: open the app online, visit Timetable / Exam Schedule / Invigilators (so data is cached), then DevTools -> Network -> Offline. The app still loads; add a timetable session (toast: saved on this device; indicator shows Offline + count). Reload the page: the pending count remains. Go back online: it syncs and the indicator turns Synced.
4. Conflict test: edit the same session in two browsers (one offline); the offline one reports *modified elsewhere*.
5. Invigilator test: add administrative staff, open an exam -> Manage -> Auto-assign, save; open an overlapping exam: those people are listed under Unavailable.

## Exam Conflict Checker: scope rule
The selected levels decide which **courses** are compared (any number of levels, at least two; every pair of selected levels is compared with `analyze()`). Every student **enrolled in any selected course** takes part, whatever their own academic level;
the student's level is shown for information only. Enrollment records are read by course ID (`listEnrollmentsForCourses`); no level (of the student or stored on the enrollment) is used to include or exclude anyone.
