import { useCallback, useEffect, useMemo, useState } from "react";
import type { Semester } from "../../domain/constants";
import { buildBusy, evaluateExam, peopleFrom, workloadOf, type Assignments } from "../../domain/invigilation";
import { listExamsBySemester } from "../../repositories/examsRepo";
import { listAdminStaff, listInvigilationsForExams } from "../../repositories/invigilationRepo";
import type { AdminStaff, Exam, InvigDoc } from "../../types";
import { useRefData } from "../timetable/useRefData";

/** Loads a semester's exams + assignments + staff once (cached) and derives everything else in memory; availability is recomputed only when they change. */
export function useInvigData(year: string, semester: Semester) {
  const refs = useRefData();
  const [exams, setExams] = useState<Exam[]>([]);
  const [invigs, setInvigs] = useState<Map<string, InvigDoc>>(new Map());
  const [staff, setStaff] = useState<AdminStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    const force = tick > 0;
    (async () => {
      const [ex, st] = await Promise.all([listExamsBySemester(year, semester, force), listAdminStaff(force)]);
      const inv = await listInvigilationsForExams(ex.map((e) => e.id), `${year}:${semester}`, force);
      if (alive) { setExams([...ex].sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)); setStaff(st); setInvigs(inv); }
    })().catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, semester, tick]);
  const people = useMemo(() => peopleFrom(refs.faculty, staff), [refs.faculty, staff]);
  const byExam = useMemo(() => new Map<string, Assignments>([...invigs].map(([id, d]) => [id, d.assignments])), [invigs]);
  const busy = useMemo(() => buildBusy(exams, byExam), [exams, byExam]);
  const evals = useMemo(() => new Map(exams.map((e) => [e.id, evaluateExam(e, byExam.get(e.id) ?? {}, people, busy)])), [exams, byExam, people, busy]);
  const workload = useMemo(() => workloadOf(byExam), [byExam]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { refs, exams, invigs, staff, people, byExam, busy, evals, workload, loading: loading || refs.loading, error, reload };
}
export type InvigData = ReturnType<typeof useInvigData>;
