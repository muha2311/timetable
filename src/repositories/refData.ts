import { collection, deleteDoc, deleteField, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import type { Role } from "../domain/constants";
import { classroomId, facultyId } from "../domain/ids";
import type { Classroom, Course, FacultyMember, Section } from "../types";
import { fdb, withMeta } from "./shared";
import { docExists, isOnline, settle } from "../services/offline/native";
import { countEntriesBy } from "./timetableRepo";

/** Thrown when a record cannot be deleted because timetable sessions still reference it. */
export class InUseError extends Error {
  count: number;
  constructor(count: number) { super("error.inUse"); this.count = count; }
}
const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
const optional = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const clearable = (v: unknown) => (v === undefined || v === null || v === "" ? deleteField() : v);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function listFaculty(): Promise<FacultyMember[]> {
  const s = await getDocs(collection(fdb(), "facultyMembers"));
  return s.docs.map((d) => withMeta<FacultyMember>(d)).sort((a, b) => a.fullName.localeCompare(b.fullName));
}
export async function listClassrooms(): Promise<Classroom[]> {
  const s = await getDocs(collection(fdb(), "classrooms"));
  return s.docs.map((d) => withMeta<Classroom>(d)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listCourses(): Promise<Course[]> {
  const s = await getDocs(collection(fdb(), "courses"));
  return s.docs.map((d) => withMeta<Course>(d)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listSections(): Promise<Section[]> {
  const s = await getDocs(collection(fdb(), "sections"));
  return s.docs.map((d) => withMeta<Section>(d));
}

// IDs are deterministic at creation and then permanent: editing a name never changes the ID, so timetable references stay valid.
export async function createFaculty(fullName: string, role: Role, extra: { department?: string; notes?: string; isActive?: boolean } = {}): Promise<string> {
  const name = fullName.trim();
  const id = facultyId(name);
  if (!id) throw new Error("error.invalidName");
  const ref = doc(fdb(), "facultyMembers", id);
  if ((await docExists(ref))) throw new Error("error.facultyExists");
  await settle(setDoc(ref, optional({ fullName: name, nameNormalized: norm(name), role, department: clean(extra.department), notes: clean(extra.notes), isActive: extra.isActive, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
  return id;
}
export async function updateFaculty(id: string, v: { fullName: string; role: Role; department?: string; notes?: string; isActive?: boolean }): Promise<void> {
  const name = v.fullName.trim();
  const dup = await getDocs(query(collection(fdb(), "facultyMembers"), where("nameNormalized", "==", norm(name))));
  if (dup.docs.some((d) => d.id !== id)) throw new Error("error.facultyExists");
  await settle(updateDoc(doc(fdb(), "facultyMembers", id), { fullName: name, nameNormalized: norm(name), role: v.role, department: clearable(clean(v.department)), notes: clearable(clean(v.notes)), ...(v.isActive !== undefined ? { isActive: v.isActive } : {}), updatedAt: serverTimestamp() }));
}
export async function deleteFaculty(id: string): Promise<void> {
  if (!isOnline()) throw new Error("error.needsConnection"); // usage in the timetable can only be verified online
  const n = await countEntriesBy("instructorId", id);
  if (n > 0) throw new InUseError(n);
  await settle(deleteDoc(doc(fdb(), "facultyMembers", id)));
}

export async function createClassroom(name: string, building: string, extra: { capacity?: number | null; notes?: string } = {}): Promise<string> {
  const id = classroomId(name, building);
  if (!id) throw new Error("error.invalidRoom");
  const ref = doc(fdb(), "classrooms", id);
  if ((await docExists(ref))) throw new Error("error.classroomExists");
  await settle(setDoc(ref, optional({ name: name.trim(), building: clean(building), capacity: extra.capacity, notes: clean(extra.notes), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
  return id;
}
export async function updateClassroom(id: string, v: { name: string; building?: string; capacity?: number | null; notes?: string }): Promise<void> {
  const wanted = classroomId(v.name, v.building ?? "");
  if (wanted !== id && (await docExists(doc(fdb(), "classrooms", wanted)))) throw new Error("error.classroomExists");
  await settle(updateDoc(doc(fdb(), "classrooms", id), { name: v.name.trim(), building: clearable(clean(v.building)), capacity: clearable(v.capacity), notes: clearable(clean(v.notes)), updatedAt: serverTimestamp() }));
}
export async function deleteClassroom(id: string): Promise<void> {
  if (!isOnline()) throw new Error("error.needsConnection");
  const n = await countEntriesBy("classroomId", id);
  if (n > 0) throw new InUseError(n);
  await settle(deleteDoc(doc(fdb(), "classrooms", id)));
}
