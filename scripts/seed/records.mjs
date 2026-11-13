// YOUR DATA GOES HERE. Add rows to either list, then run `npm run seed`.
// Existing documents are never overwritten, so you can add rows and re-run safely.
//
// facultyMembers row:  { fullName: "Full Name", role: "Lecturer", department: "optional", notes: "optional" }
//   role must be one of: Professor | Lecturer | Assistant Lecturer | Teaching Assistant
//   document ID = slug(fullName)            e.g. "Aya Fawzi" -> "aya-fawzi"
// classrooms row:      { name: "Hall 3", building: "optional", capacity: 120, notes: "optional" }
//   document ID = slug(building + " " + name)
export const facultyMembers = [
  // Professors
  { fullName: "Osama Elbaksawy", role: "Professor" },
  { fullName: "Sara Ziada", role: "Professor" },
  { fullName: "Sara Abu Hasheesh", role: "Professor" },
  { fullName: "Hala ElHadidy", role: "Professor" },
  { fullName: "Walaa Saber", role: "Professor" },
  { fullName: "Islam Shaalan", role: "Professor" },
  { fullName: "Reham Moharram", role: "Professor" },
  { fullName: "Aya Fawzy", role: "Professor" },
  { fullName: "Hewayda Elghawalby", role: "Professor" },
  { fullName: "Youssef Elboghdady", role: "Professor" },
  { fullName: "Doaa Elmorshedy", role: "Professor" },
  { fullName: "Mona Nashaat", role: "Professor" },
  // Teaching Assistants
  { fullName: "Noran Fawzy", role: "Teaching Assistant" },
  { fullName: "Mohammed Ayman", role: "Teaching Assistant" },
  { fullName: "Tasneem Mohsen", role: "Teaching Assistant" },
  { fullName: "Rawan Zangeer", role: "Teaching Assistant" },
  { fullName: "Mona Mohammed", role: "Teaching Assistant" },
  { fullName: "Nada Elmor", role: "Teaching Assistant" },
  { fullName: "Sama Bessar", role: "Teaching Assistant" },
  { fullName: "Menne Eltabee", role: "Teaching Assistant" },
  { fullName: "Mariam Ali", role: "Teaching Assistant" },
  { fullName: "Amira Hamed", role: "Teaching Assistant" },
  { fullName: "Ranim Elsonbaty", role: "Teaching Assistant" },
  { fullName: "Mai Moussa", role: "Teaching Assistant" },
];

// capacity: null = NOT PROVIDED YET (nothing is invented). Replace null with the real number before the first seed, or set it
// later in the Classrooms page. Re-running the seed never overwrites existing rooms, so it will not touch capacities you entered.
export const classrooms = [
  // Building A
  { name: "Hall 1", building: "Building A", capacity: null },
  { name: "Hall 2", building: "Building A", capacity: null },
  { name: "Hall 3", building: "Building A", capacity: null },
  { name: "Hall 4", building: "Building A", capacity: null },
  { name: "Classroom 104", building: "Building A", capacity: null },
  { name: "Classroom 105", building: "Building A", capacity: null },
  { name: "Classroom 106", building: "Building A", capacity: null },
  { name: "Laboratory 2", building: "Building A", capacity: null },
  { name: "Drawing Hall 3", building: "Building A", capacity: null },
  // Building not specified (no building field; IDs are "lab-1" and "lab-2")
  { name: "Lab 1", capacity: null },
  { name: "Lab 2", capacity: null },
  // Building B
  { name: "Hall 1", building: "Building B", capacity: null },
  { name: "Hall 2", building: "Building B", capacity: null },
  { name: "Hall 3", building: "Building B", capacity: null },
  { name: "Hall 4", building: "Building B", capacity: null },
  { name: "Laboratory 1", building: "Building B", capacity: null },
  { name: "Laboratory 2", building: "Building B", capacity: null },
  { name: "Classroom 101", building: "Building B", capacity: null },
  { name: "Classroom 104", building: "Building B", capacity: null },
  { name: "Classroom 105", building: "Building B", capacity: null },
  { name: "Classroom 106", building: "Building B", capacity: null },
  { name: "Classroom 301", building: "Building B", capacity: null },
  { name: "Classroom 201", building: "Building B", capacity: null },
  { name: "Lab 1", building: "Building B", capacity: null },
  { name: "Lab 2", building: "Building B", capacity: null },
];
