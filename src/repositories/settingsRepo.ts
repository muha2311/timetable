import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import type { Institution } from "../types";
import { settle } from "../services/offline/native";
import { cached, invalidate } from "./cache";
import { fdb } from "./shared";

export const EMPTY_INSTITUTION: Institution = { universityNameEn: "", universityNameAr: "", facultyNameEn: "", facultyNameAr: "", headerEn: "", headerAr: "", footerEn: "", footerAr: "", universityLogo: "", facultyLogo: "" };

/** Branding lives in settings/institution (no names or logos are hardcoded anywhere). */
export const getInstitution = (force = false): Promise<Institution> => cached("data:settings", async () => {
  const s = await getDoc(doc(fdb(), "settings", "institution"));
  return { ...EMPTY_INSTITUTION, ...(s.exists() ? (s.data() as Partial<Institution>) : {}) };
}, { force });

export async function saveInstitution(v: Institution): Promise<void> {
  await settle(setDoc(doc(fdb(), "settings", "institution"), { ...v, updatedAt: serverTimestamp() }, { merge: true }));
  invalidate("data:settings");
}
