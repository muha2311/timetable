// Idempotent, create-only seed. Signs in with YOUR admin account via the normal client SDK
// (no service-account key needed). Usage: npm run seed [-- --dry-run] [-- --yes]
import { createInterface } from "node:readline/promises";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDocs, getFirestore, serverTimestamp, writeBatch } from "firebase/firestore";
import { classrooms, facultyMembers } from "./records.mjs";
import { buildWanted, planSeed, validateRecords } from "./plan.mjs";

const dryRun = process.argv.includes("--dry-run");
const env = process.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
};
if (!config.apiKey || !config.projectId || !config.appId) { console.error("Missing VITE_FIREBASE_* values. Create .env.local first (see .env.example)."); process.exit(1); }

const errors = validateRecords({ facultyMembers, classrooms });
if (errors.length) { console.error("Fix scripts/seed/records.mjs:\n  " + errors.join("\n  ")); process.exit(1); }

const ask = async (q) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(q); rl.close(); return a.trim(); };

// Safety: make you confirm which project will be written to.
if (!dryRun && !process.argv.includes("--yes")) {
  const a = await ask(`This will CREATE missing documents in Firebase project "${config.projectId}" (nothing is overwritten or deleted).\nType the project ID to continue: `);
  if (a !== config.projectId) { console.error("Cancelled."); process.exit(1); }
}

const app = initializeApp(config);
try {
  await signInWithEmailAndPassword(getAuth(app), env.SEED_EMAIL || (await ask("Admin email: ")), env.SEED_PASSWORD || (await ask("Admin password (visible as you type): ")));
} catch (e) { console.error(`Sign-in failed (${e.code ?? e.message}). Use the user created in Firebase Authentication.`); process.exit(1); }
const db = getFirestore(app);

try {
  const existing = new Set();
  for (const c of ["academicLevels", "sections", "courses", "facultyMembers", "classrooms"]) (await getDocs(collection(db, c))).forEach((d) => existing.add(`${c}/${d.id}`));
  const { create, skip } = planSeed(buildWanted({ facultyMembers, classrooms }), existing);
  console.log(`${create.length} to create, ${skip.length} already exist (left untouched).`);
  if (dryRun) create.forEach((m) => console.log(`  would create ${m.col}/${m.id}`));
  else for (let i = 0; i < create.length; i += 400) {
    const batch = writeBatch(db);
    create.slice(i, i + 400).forEach((m) => batch.set(doc(db, m.col, m.id), { ...m.data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await batch.commit();
  }
  console.log(dryRun ? "Dry run: nothing written." : `Done. Created ${create.length}.`);
  process.exit(0);
} catch (e) {
  console.error(`Firestore error (${e.code ?? e.message}).`, e.code === "permission-denied" ? "Check firestore.rules (your email, published, verified)." : "");
  process.exit(1);
}
