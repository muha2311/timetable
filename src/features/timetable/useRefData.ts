import { useCallback, useEffect, useState } from "react";
import { cached, peek } from "../../repositories/cache";
import { listClassrooms, listCourses, listFaculty, listSections } from "../../repositories/refData";
import type { Classroom, Course, FacultyMember, Section } from "../../types";

interface Data { faculty: FacultyMember[]; classrooms: Classroom[]; sections: Section[]; courses: Course[] }
const EMPTY: Data = { faculty: [], classrooms: [], sections: [], courses: [] };
const KEY = "refs";

/** Reference data is read once and shared by all pages (5 min cache). `reload()` forces a fresh read after you change records. */
export function useRefData() {
  const [data, setData] = useState<Data>(() => peek<Data>(KEY) ?? EMPTY);
  const [loading, setLoading] = useState(() => peek<Data>(KEY) === undefined);
  const [error, setError] = useState("");
  const load = useCallback(async (force: boolean) => {
    try {
      setData(await cached<Data>(KEY, async () => {
        const [faculty, classrooms, sections, courses] = await Promise.all([listFaculty(), listClassrooms(), listSections(), listCourses()]);
        return { faculty, classrooms, sections, courses };
      }, { force }));
      setError("");
    } catch { setError("refs.loadFailed"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(false); }, [load]);
  const reload = useCallback(() => load(true), [load]);
  return { ...data, loading, error, reload };
}
export type RefData = ReturnType<typeof useRefData>;
