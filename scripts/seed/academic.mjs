// DEFAULT ACADEMIC DATA (levels + sections). Edit section counts here if the faculty changes.
import { courseId, levelId, sectionId } from "./ids.mjs";

export const SECTION_COUNTS = { 1: 10, 2: 8, 3: 4, 4: 1 };
// Canonical English course names (Fall / first semester). Arabic display names live in src/locales.
export const COURSES = {
  1: ["Math 1", "Programming Fundamentals", "Fundamentals of Computer Science", "Physics", "Discrete Mathematics", "Principle of Human Law"],
  2: ["OOP", "System Analysis and Design", "Numerical Analysis", "Math 3", "Computer Skills", "Logic Design"],
  3: ["Algorithms and Design", "Artificial Intelligence", "Selected Topics in CS", "Computer Network", "Human Civilization", "Societal Issues"],
  4: ["Parallel Computing", "Theory of Computation", "Cloud Computing", "Deep Learning", "Image Processing"]
};
const levels = Object.keys(SECTION_COUNTS).map(Number);

export const academicLevels = () => levels.map((l) => ({ col: "academicLevels", id: levelId(l), data: { level: l, name: `Level ${l}` } }));
export const courses = () => levels.flatMap((l) => COURSES[l].map((name) => ({ col: "courses", id: courseId(l, "Fall", name), data: { level: l, semester: "Fall", name } })));
export const sections = () => levels.flatMap((l) =>
  Array.from({ length: SECTION_COUNTS[l] }, (_, i) => ({ col: "sections", id: sectionId(l, String(i + 1)), data: { level: l, name: String(i + 1) } })));
