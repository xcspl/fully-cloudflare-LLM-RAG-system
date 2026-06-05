import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const INPUT = resolve(import.meta.dirname!, "../data/86-raw-posts.json");
const OUTPUT = resolve(import.meta.dirname!, "../data/86-posts-ingest-ready.json");

interface RawPost {
  id: number;
  title: string;
  author_name: string;
  post_type: string;
  LatLong: { latitude: number; longitude: number } | null;
  body: {
    Tags?: { projectType?: string; projectStatus?: string };
    Category?: string;
    BasicData?: Record<string, string>;
    ContactInfo?: { Email?: string; Contact_Person?: string };
    Description?: Record<string, string>;
    AdditionalInfo?: Record<string, string>;
  };
}

interface IngestPayload {
  data: Record<string, string | number>;
  key_keys: string[];
  source: string;
  postid: string;
}

const FIELD_MAP: [string, (p: RawPost) => string | number | undefined][] = [
  ["title", (p) => p.title || undefined],
  ["author_name", (p) => p.author_name || undefined],
  ["lat", (p) => p.LatLong?.latitude],
  ["lng", (p) => p.LatLong?.longitude],
  ["category", (p) => p.body.Category || undefined],
  ["project_type", (p) => p.body.Tags?.projectType || undefined],
  ["project_status", (p) => p.body.Tags?.projectStatus || undefined],
  ["region", (p) => p.body.BasicData?.Region || undefined],
  ["country", (p) => p.body.BasicData?.Country || undefined],
  ["org_name", (p) => p.body.BasicData?.Name_Of_Org || undefined],
  ["support_link", (p) => p.body.BasicData?.Support_Link || undefined],
  ["solution_website", (p) => p.body.BasicData?.Solution_Website || undefined],
  ["org_website", (p) => p.body.BasicData?.Organization_Website || undefined],
  ["primary_action", (p) => p.body.BasicData?.Primary_Conservation_Action || undefined],
  ["secondary_action", (p) => p.body.BasicData?.Secondary_Conservation_Action || undefined],
  ["contact_email", (p) => p.body.ContactInfo?.Email || undefined],
  ["contact_person", (p) => p.body.ContactInfo?.Contact_Person || undefined],
  ["support_needed", (p) => p.body.Description?.Support_Needed || undefined],
  ["problem_statement", (p) => p.body.Description?.Problem_Statement || undefined],
  ["result_and_outcome", (p) => p.body.Description?.Result_And_Outcome || undefined],
  ["description_of_solution", (p) => p.body.Description?.Description_Of_Solution || undefined],
  ["org_mission", (p) => p.body.Description?.Organization_Mission_Statement || undefined],
  ["activities", (p) => p.body.Description?.Activities_To_Solve_The_Problem || undefined],
  ["impact_tracks", (p) => p.body.AdditionalInfo?.Impact_Tracks || undefined],
  ["project_value", (p) => p.body.AdditionalInfo?.Project_Value || undefined],
  ["species_focus", (p) => p.body.AdditionalInfo?.Species_Focus || undefined],
  ["impact_numbers", (p) => p.body.AdditionalInfo?.Impact_Numbers || undefined],
  ["lessons_learned", (p) => p.body.AdditionalInfo?.Lessons_Learned || undefined],
  ["project_start", (p) => p.body.AdditionalInfo?.Project_Start_Date || undefined],
  ["project_end", (p) => p.body.AdditionalInfo?.Project_End_Date || undefined],
  ["post_url", (p) => `https://map.earth-team.org/post/${p.id}`],
];

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (typeof v === "number" && (isNaN(v) || v === 0)) return false; // 0 is a valid lat/lng
  return false;
}

function transform(post: RawPost): IngestPayload {
  const data: Record<string, string | number> = {};

  for (const [key, extractor] of FIELD_MAP) {
    const value = extractor(post);
    if (!isEmpty(value)) {
      data[key] = value!;
    }
  }

  return {
    data,
    key_keys: Object.keys(data),
    source: post.post_type,
    postid: String(post.id),
  };
}

const raw = JSON.parse(readFileSync(INPUT, "utf-8")) as { results: RawPost[] };
const payloads: IngestPayload[] = raw.results.map(transform);

writeFileSync(OUTPUT, JSON.stringify(payloads, null, 2) + "\n", "utf-8");

const totalFields = payloads.reduce((sum, p) => sum + Object.keys(p.data).length, 0);
console.log(`Transformed ${payloads.length} posts → ${OUTPUT}`);
console.log(`Average fields per post: ${(totalFields / payloads.length).toFixed(1)}`);
