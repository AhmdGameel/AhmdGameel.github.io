import warehouse from '../data/warehouse.json';
import run from '../data/run.json';

export interface Experience {
  id: string;
  type: 'work' | 'training';
  role: string;
  company: string;
  context: string;
  mode: string;
  start_month: string;
  end_month: string | null;
  is_current: boolean;
  stack: string[];
  highlights: string[];
}

export interface TopoNode { id: string; label: string; sub: string; x: number; y: number }

export interface Metric {
  label: string;
  value: string;
  kind: 'code' | 'readme' | 'derived' | null;
  source: string | null;
  source_url: string | null;
  how: string;
}

export interface Project {
  id: string;
  name: string;
  kind: string;
  featured: boolean;
  summary: string;
  problem: string;
  built: string;
  result: string;
  decisions: { title: string; body: string }[];
  next: string[];
  media: { src: string; poster: string; caption: string } | null;
  stack: string[];
  repo: string;
  repo_url: string;
  created: string | null;
  last_push: string | null;
  metrics: Metric[];
  topology: TopoNode[];
  edges: [string, string][];
}

export interface Skill { skill: string; category: string; tier: 'work' | 'built' | 'trained' | 'listed'; evidence_count: number }
export interface Evidence { skill: string; category: string; evidence_id: string; evidence: string; kind: string }
export interface Check { name: string; passed: boolean; detail: string; blocking: boolean }
export interface RunSummary { run_id: string; started_at: string; duration_ms: number; rows_total: number; checks_passed: number; checks_total: number; trigger: string; commit: string }

export const person = warehouse.person[0];
export const experience = warehouse.experience as Experience[];
export const projects = warehouse.projects as unknown as Project[];
export const skills = warehouse.skills as Skill[];
export const skillGroups = warehouse.skill_groups as { group: string; items: string[] }[];
export const evidence = warehouse.skill_evidence as Evidence[];
export const certifications = warehouse.certifications as { name: string; issuer: string; date: string; url: string | null }[];
export const education = warehouse.education;
export const repos = warehouse.repos;
export const pipelineRun = run as typeof run & { checks: Check[]; history: RunSummary[] };

export interface OperatorPerf { operator: string; total_towers: number; lte_towers: number; umts_towers: number; gsm_towers: number; lte_pct: number; umts_pct: number; gsm_pct: number; areas_covered: number; performance_rank: number }
export interface AreaRisk { area: number; total_towers: number; lte_coverage_pct: number; risk_level: 'HIGH' | 'MEDIUM' | 'LOW'; risk_score: number }
const w = warehouse as unknown as { dbt_operator_performance?: OperatorPerf[]; dbt_regional_risk_index?: AreaRisk[] };
/** Outputs of the dbt models in tower-health-stream, when the CSV exports are in pipeline/sources. */
export const batch = { operators: w.dbt_operator_performance ?? [], risk: w.dbt_regional_risk_index ?? [] };

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

export function duration(start: string, end: string | null): string {
  const n = monthRange(start, end ?? currentMonth()).length;
  if (n < 12) return n === 1 ? '1 month' : `${n} months`;
  const y = Math.floor(n / 12), r = n % 12;
  return `${y} yr${y > 1 ? 's' : ''}${r ? ` ${r} mo` : ''}`;
}

export const KIND_LABEL: Record<string, string> = { code: 'from code', readme: 'from README', derived: 'calculated' };
