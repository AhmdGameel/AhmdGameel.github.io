/**
 * Requirement catalog for the role fit check. Each requirement is something a data engineering
 * job post asks for, the words that signal it, and the profile skills (or projects) that prove it.
 * A requirement with no skills is a known gap: it is listed honestly as "not used yet".
 */

export interface Req {
  label: string;
  pattern: string; // case insensitive regular expression
  skills: string[];
  projects?: string[];
  popular?: boolean;
}

export const REQS: Req[] = [
  { label: 'Python', pattern: '\\bpython\\b', skills: ['Python'], popular: true },
  { label: 'SQL', pattern: '\\bsql\\b|t-sql|tsql', skills: ['SQL'], popular: true },
  { label: 'Spark', pattern: '\\bspark\\b|pyspark', skills: ['PySpark', 'Apache Spark'], popular: true },
  { label: 'Airflow', pattern: '\\bairflow\\b|orchestrat', skills: ['Apache Airflow'], popular: true },
  { label: 'AWS', pattern: '\\baws\\b|amazon web services|\\bglue\\b|\\bs3\\b', skills: ['AWS Glue', 'Amazon S3'], popular: true },
  { label: 'Kafka', pattern: '\\bkafka\\b', skills: ['Apache Kafka'], popular: true },
  { label: 'Streaming', pattern: 'real[- ]?time|streaming|event[- ]driven', skills: ['Apache Kafka', 'Apache Flink'] },
  { label: 'Flink', pattern: '\\bflink\\b', skills: ['Apache Flink'] },
  { label: 'ETL and ELT', pattern: '\\betl\\b|\\belt\\b|data pipelines?', skills: ['AWS Glue', 'Apache Airflow', 'SQL Server'] },
  { label: 'Data modeling', pattern: 'data model|dimensional|star schema|kimball|data warehous', skills: ['Data Modeling', 'SQL Server'], popular: true },
  { label: 'dbt', pattern: '\\bdbt\\b', skills: ['dbt'], popular: true },
  { label: 'Docker', pattern: 'docker|container', skills: ['Docker'], popular: true },
  { label: 'Data quality', pattern: 'data quality|data validation|data contract', skills: [], projects: ['Tower Health Stream', 'Log Analytics ETL'] },
  { label: 'CI/CD', pattern: 'ci/cd|github actions|continuous integration', skills: [], projects: ['This website, built and checked by GitHub Actions'] },
  { label: 'Azure', pattern: '\\bazure\\b', skills: ['Azure', 'Microsoft Fabric'], popular: true },
  { label: 'Microsoft Fabric', pattern: '\\bfabric\\b', skills: ['Microsoft Fabric'] },
  { label: 'Cloud', pattern: '\\bcloud\\b', skills: ['AWS Glue', 'Amazon S3', 'Azure', 'Microsoft Fabric'] },
  { label: 'PostgreSQL', pattern: 'postgres', skills: ['PostgreSQL'] },
  { label: 'SQL Server and SSIS', pattern: 'sql server|\\bssis\\b|mssql', skills: ['SQL Server'] },
  { label: 'MySQL', pattern: '\\bmysql\\b', skills: ['MySQL'] },
  { label: 'MongoDB', pattern: 'mongo', skills: ['MongoDB'] },
  { label: 'DuckDB', pattern: 'duckdb', skills: ['DuckDB'] },
  { label: 'Hadoop and Hive', pattern: 'hadoop|\\bhdfs\\b|\\bhive\\b', skills: ['Hadoop', 'Hive'] },
  { label: 'Iceberg and lakehouse', pattern: 'iceberg|lakehouse', skills: ['Apache Iceberg'] },
  { label: 'Parquet', pattern: 'parquet', skills: ['Parquet'] },
  { label: 'NiFi', pattern: '\\bnifi\\b', skills: ['Apache NiFi'] },
  { label: 'Power BI', pattern: 'power ?bi|\\bdax\\b', skills: ['Power BI', 'DAX'] },
  { label: 'Grafana', pattern: 'grafana', skills: ['Grafana'] },
  { label: 'Linux', pattern: 'linux|unix', skills: ['Linux'] },
  { label: 'Git', pattern: '\\bgit\\b|github|gitlab', skills: ['Git'] },
  { label: 'Bash', pattern: '\\bbash\\b|shell script', skills: ['Bash'] },
  // Common asks that are not on the profile yet.
  { label: 'Snowflake', pattern: 'snowflake', skills: [], popular: true },
  { label: 'Databricks', pattern: 'databricks', skills: [], popular: true },
  { label: 'BigQuery', pattern: 'bigquery', skills: [] },
  { label: 'Redshift', pattern: 'redshift', skills: [] },
  { label: 'Google Cloud', pattern: 'google cloud|\\bgcp\\b', skills: [] },
  { label: 'Terraform', pattern: 'terraform', skills: [] },
  { label: 'Kubernetes', pattern: 'kubernetes|\\bk8s\\b', skills: [] },
  { label: 'Scala', pattern: '\\bscala\\b', skills: [] },
  { label: 'Java', pattern: '\\bjava\\b', skills: [] },
  { label: 'Tableau', pattern: 'tableau', skills: [] },
  { label: 'Looker', pattern: 'looker', skills: [] },
  { label: 'Delta Lake', pattern: 'delta lake', skills: [] },
  { label: 'Fivetran or Airbyte', pattern: 'fivetran|airbyte', skills: [] },
  { label: 'Dagster or Prefect', pattern: 'dagster|prefect', skills: [] },
];

export type Kind = 'work' | 'project' | 'repo' | 'training' | 'cert';
export interface Proof { label: string; kind: Kind }
export type EvidenceMap = Record<string, Proof[]>;

const RANK: Record<Kind, number> = { work: 0, project: 1, repo: 1, training: 2, cert: 2 };

export interface Match { req: Req; proofs: Proof[]; best: Kind | null }

export function evaluate(text: string, picked: Set<string>, evidence: EvidenceMap): Match[] {
  const lower = text.toLowerCase();
  const active = REQS.filter((r) => picked.has(r.label) || (lower && new RegExp(r.pattern, 'i').test(lower)));
  return active
    .map((req) => {
      const seen = new Set<string>();
      const proofs: Proof[] = [];
      for (const s of req.skills) for (const p of evidence[s] ?? []) {
        if (!seen.has(p.label)) { seen.add(p.label); proofs.push(p); }
      }
      for (const label of req.projects ?? []) if (!seen.has(label)) { seen.add(label); proofs.push({ label, kind: 'project' }); }
      proofs.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
      return { req, proofs, best: proofs[0]?.kind ?? null };
    })
    .sort((a, b) => (a.best === null ? 9 : RANK[a.best]) - (b.best === null ? 9 : RANK[b.best]));
}

export const KIND_TEXT: Record<Kind, string> = {
  work: 'Used at work',
  project: 'Built in a project',
  repo: 'In a public repo',
  training: 'From training',
  cert: 'Certificate or course',
};
