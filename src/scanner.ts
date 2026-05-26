import fs from "node:fs"
import path from "node:path"

export type ScanResults = {
  frontend: string[]
  backend: string[]
  deployment: string[]
  database: string[]
  auth: string[]
  billing: string[]
  ui: string[]
  warnings: string[]
  recommendations: string[]
  projectStructure: string[]
  envVariables: string[]
  packageManager: string | null
  typescript: boolean
  monorepo: boolean
  vite: boolean
  railway: boolean
  docker: boolean
}

function createEmptyResults(): ScanResults {
  return {
    frontend: [],
    backend: [],
    deployment: [],
    database: [],
    auth: [],
    billing: [],
    ui: [],
    warnings: [],
    recommendations: [],
    projectStructure: [],
    envVariables: [],
    packageManager: null,
    typescript: false,
    monorepo: false,
    vite: false,
    railway: false,
    docker: false
  }
}

function formatList(values: string[]): string {
  return values.length ? values.join(", ") : "None"
}

function readDependenciesFromPackage(packagePath: string) {
  if (!fs.existsSync(packagePath)) {
    return {}
  }

  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  return {
    ...(parsed.dependencies || {}),
    ...(parsed.devDependencies || {})
  }
}

export async function scanEntireApp(rootDir: string): Promise<ScanResults> {
  const results = createEmptyResults()

  const packageJsonPath = path.join(rootDir, "package.json")

  if (!fs.existsSync(packageJsonPath)) {
    results.warnings.push("No package.json found")
    return results
  }

  const dependencies = {
    ...readDependenciesFromPackage(packageJsonPath)
  }

  // Include common frontend sub-app folders in stack detection.
  const subApps = ["client", "frontend", "web"]

  for (const subApp of subApps) {
    const subPackage = path.join(rootDir, subApp, "package.json")
    Object.assign(dependencies, readDependenciesFromPackage(subPackage))
  }

  if (fs.existsSync(path.join(rootDir, "pnpm-lock.yaml"))) {
    results.packageManager = "pnpm"
  } else if (fs.existsSync(path.join(rootDir, "package-lock.json"))) {
    results.packageManager = "npm"
  } else if (fs.existsSync(path.join(rootDir, "yarn.lock"))) {
    results.packageManager = "yarn"
  }

  results.typescript = fs.existsSync(path.join(rootDir, "tsconfig.json"))
  results.monorepo = fs.existsSync(path.join(rootDir, "pnpm-workspace.yaml"))

  if (dependencies.react) results.frontend.push("React")
  if (dependencies.vue) results.frontend.push("Vue")
  if (dependencies.next) results.frontend.push("Next.js")

  if (
    fs.existsSync(path.join(rootDir, "vite.config.ts")) ||
    fs.existsSync(path.join(rootDir, "vite.config.js"))
  ) {
    results.frontend.push("Vite")
    results.vite = true
  }

  if (dependencies.express) results.backend.push("Express")
  if (dependencies.fastify) results.backend.push("Fastify")
  if (dependencies["@nestjs/core"]) results.backend.push("NestJS")
  if (dependencies.hono) results.backend.push("Hono")

  if (dependencies["drizzle-orm"]) results.database.push("Drizzle ORM")
  if (dependencies.prisma) results.database.push("Prisma")
  if (dependencies.mongoose) results.database.push("MongoDB / Mongoose")
  if (dependencies.postgres) results.database.push("PostgreSQL")
  if (dependencies.sqlite3) results.database.push("SQLite")

  if (dependencies["@clerk/clerk-react"]) results.auth.push("Clerk")
  if (dependencies["@supabase/supabase-js"]) results.auth.push("Supabase Auth")
  if (dependencies.firebase) results.auth.push("Firebase Auth")
  if (dependencies["next-auth"]) results.auth.push("NextAuth")
  if (dependencies.jsonwebtoken) results.auth.push("JWT Auth")

  if (dependencies.stripe) results.billing.push("Stripe")

  if (dependencies.tailwindcss) results.ui.push("Tailwind")
  if (dependencies["@radix-ui/react-dialog"]) results.ui.push("shadcn/ui")

  if (
    fs.existsSync(path.join(rootDir, "railway.toml")) ||
    fs.existsSync(path.join(rootDir, "railway.json"))
  ) {
    results.deployment.push("Railway")
    results.railway = true
  }

  if (fs.existsSync(path.join(rootDir, "Dockerfile"))) {
    results.deployment.push("Docker")
    results.docker = true
  }

  if (fs.existsSync(path.join(rootDir, "vercel.json"))) {
    results.deployment.push("Vercel")
  }

  const envPath = path.join(rootDir, ".env")

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8")
    const matches = envContent.match(/^[A-Z0-9_]+/gm)

    if (matches) {
      results.envVariables.push(...matches)
    }
  }

  const folders = ["src", "app", "server", "api", "routes", "components", "pages", "lib"]

  for (const folder of folders) {
    if (fs.existsSync(path.join(rootDir, folder))) {
      results.projectStructure.push(folder)
    }
  }

  if (!results.auth.length) results.warnings.push("No authentication system detected")
  if (!results.billing.length) results.warnings.push("No billing system detected")
  if (!results.database.length) results.warnings.push("No database detected")

  if (results.auth.includes("Clerk")) {
    results.warnings.push("Existing Clerk system detected")
  }

  if (results.frontend.includes("React") && results.backend.includes("Express")) {
    results.recommendations.push("Recommended integration: JWT + Stripe + Cookie Auth")
  }

  if (results.vite) {
    results.recommendations.push("Enable SPA fallback support")
  }

  if (results.railway) {
    results.recommendations.push("Use process.env.PORT || 8080")
    results.recommendations.push("Add Railway healthcheck route")
  }

  return results
}

export function createIntegrationPlan(results: ScanResults) {
  return {
    detectedStack: {
      frontend: results.frontend,
      backend: results.backend,
      database: results.database,
      auth: results.auth,
      billing: results.billing,
      deployment: results.deployment
    },
    installStrategy: {
      auth: results.auth.length ? "Merge Existing Auth" : "Install JWT Auth",
      stripe: results.billing.length ? "Merge Existing Stripe" : "Install Stripe",
      deployment: results.railway ? "Railway Optimized" : "Standard Deployment"
    },
    filesToCreate: ["auth.ts", "billing.ts", "middleware.ts", "stripe-webhook.ts", "env-validator.ts"],
    filesToModify: ["server.ts", "package.json", ".env"],
    warnings: results.warnings,
    recommendations: results.recommendations
  }
}

export function diagnoseProject(results: ScanResults) {
  const issues: string[] = []

  if (!results.envVariables.includes("DATABASE_URL")) {
    issues.push("DATABASE_URL missing")
  }

  if (!results.envVariables.includes("JWT_SECRET")) {
    issues.push("JWT_SECRET missing")
  }

  if (!results.envVariables.includes("STRIPE_SECRET_KEY")) {
    issues.push("STRIPE_SECRET_KEY missing")
  }

  if (results.railway && !results.envVariables.includes("PORT")) {
    issues.push("PORT variable missing for Railway")
  }

  return issues
}

export function printResults(results: ScanResults) {
  console.log(`
========================================
APP SCAN RESULTS
========================================

FRONTEND:
${formatList(results.frontend)}

BACKEND:
${formatList(results.backend)}

DATABASE:
${formatList(results.database)}

AUTH:
${formatList(results.auth)}

BILLING:
${formatList(results.billing)}

DEPLOYMENT:
${formatList(results.deployment)}

UI:
${formatList(results.ui)}

PACKAGE MANAGER:
${results.packageManager || "Unknown"}

TYPESCRIPT:
${results.typescript}

MONOREPO:
${results.monorepo}

========================================
WARNINGS
========================================

${results.warnings.length ? results.warnings.join("\n") : "None"}

========================================
RECOMMENDATIONS
========================================

${results.recommendations.length ? results.recommendations.join("\n") : "None"}

========================================
`)
}

export async function runScanner(rootDir = process.cwd()) {
  const results = await scanEntireApp(rootDir)
  printResults(results)

  const plan = createIntegrationPlan(results)
  console.log("INTEGRATION PLAN:")
  console.log(JSON.stringify(plan, null, 2))

  const issues = diagnoseProject(results)
  console.log("PROJECT ISSUES:", issues.length ? issues : ["None"])

  return {
    results,
    plan,
    issues
  }
}

if (require.main === module) {
  runScanner().catch((error) => {
    console.error("Scanner failed:", error)
    process.exit(1)
  })
}
