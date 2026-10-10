import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, relative } from 'node:path'
import type { Command } from 'commander'
import { readProjectEnv } from '../core/env.js'
import { requireProject, type ProjectInfo } from '../core/project.js'

export interface DoctorCheck {
  name: string
  ok: boolean
  hint?: string
}

export interface DoctorDeps {
  env?: Record<string, string | undefined>
  tcpCheck?: (host: string, port: number) => Promise<boolean>
}

function tcpReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 3000 })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('timeout', () => (socket.destroy(), resolve(false)))
    socket.once('error', () => (socket.destroy(), resolve(false)))
  })
}

/** First host:port of a connection string, tolerating credentials and mongodb multi-host lists. */
function firstHostPort(url: string): { host: string; port: number } | null {
  const m = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(url)
  const first = m?.[1]?.split(',')[0]
  if (!first) return null
  const [host, port] = first.split(':')
  if (!host) return null
  const scheme = url.split(':')[0]!.toLowerCase()
  const fallback = scheme.startsWith('mongodb') ? 27017 : 5432
  return { host, port: port ? Number(port) : fallback }
}

export async function runDoctor(project: ProjectInfo, deps: DoctorDeps = {}): Promise<DoctorCheck[]> {
  const env = deps.env ?? readProjectEnv(project.root)
  const tcpCheck = deps.tcpCheck ?? tcpReachable
  const checks: DoctorCheck[] = []

  checks.push({ name: `${relative(project.root, project.configPath)} found`, ok: true })
  checks.push({
    name: 'dependencies installed',
    ok: existsSync(join(project.root, 'node_modules', 'payload')),
    hint: `Run \`${project.packageManager} install\`.`,
  })

  const major = Number(process.versions.node.split('.')[0])
  checks.push({ name: `Node ${process.versions.node}`, ok: major >= 20, hint: 'Payload 3 needs Node 20.9 or newer.' })

  checks.push({
    name: 'PAYLOAD_SECRET is set',
    ok: Boolean(env.PAYLOAD_SECRET),
    hint: 'Add PAYLOAD_SECRET to .env (copy .env.example).',
  })

  const url = env.DATABASE_URL
  checks.push({
    name: 'DATABASE_URL is set',
    ok: Boolean(url),
    hint: 'Add DATABASE_URL to .env (copy .env.example).',
  })
  if (!url) return checks

  const config = readFileSync(project.configPath, 'utf8')
  const adapter = /postgresAdapter/.test(config) ? 'postgres' : /mongooseAdapter/.test(config) ? 'mongodb' : null
  if (adapter) {
    const matches = adapter === 'postgres' ? /^postgres(ql)?:\/\//i.test(url) : /^mongodb(\+srv)?:\/\//i.test(url)
    checks.push({
      name: `DATABASE_URL matches the ${adapter} adapter`,
      ok: matches,
      hint: `The config uses the ${adapter} adapter; DATABASE_URL should start with ${
        adapter === 'postgres' ? 'postgres://' : 'mongodb://'
      }.`,
    })
  }

  if (/^mongodb\+srv:/i.test(url)) {
    checks.push({ name: 'database reachable (mongodb+srv: not checked)', ok: true })
  } else {
    const target = firstHostPort(url)
    checks.push({
      name: target ? `database reachable at ${target.host}:${target.port}` : 'database reachable',
      ok: target ? await tcpCheck(target.host, target.port) : false,
      hint: target
        ? 'Is the database running and the host/port in DATABASE_URL correct?'
        : 'DATABASE_URL could not be parsed.',
    })
  }
  return checks
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check the project setup: config, dependencies, env vars and database')
    .action(async () => {
      const checks = await runDoctor(requireProject(process.cwd()))
      for (const c of checks) {
        console.log(`${c.ok ? '✓' : '✗'} ${c.name}${!c.ok && c.hint ? `\n    ${c.hint}` : ''}`)
      }
      if (checks.some((c) => !c.ok)) process.exitCode = 1
    })
}
