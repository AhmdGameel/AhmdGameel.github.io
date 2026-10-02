import warehouse from '../data/warehouse.json';
import run from '../data/run.json';

export interface Experience {
  id: string;
  role: string;
  company: string;
  mode: string;
  start_month: string;
  end_month: string | null;
  is_current: boolean;
  stack: string[];
  highlights: string[];
}

export interface TopoNode { id: string; label: string; sub: string; x: number; y: number }

export interface Project {
  id: string;
  name: string;
  kind: string;
  featured: boolean;
  summary: string;
  problem: string;
  built: string;
  result: string;
  stack: string[];
  repo_url: string;
  stars: number;
  last_push: string | null;
  metrics: { label: string; value: string }[];
  topology: TopoNode[];
  edges: [string, string][];
}

export const person = warehouse.person[0];
export const experience = warehouse.experience as Experience[];
export const projects = warehouse.projects as Project[];
export const skillGroups = warehouse.skill_groups as { group: string; items: string[] }[];
export const certifications = warehouse.certifications;
export const education = warehouse.education;
export const repos = warehouse.repos;
export const pipelineRun = run;

/** Month keys (YYYY-MM) from start to end inclusive. */
export function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtMonth(key: string | null): string {
  if (!key) return 'Present';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
