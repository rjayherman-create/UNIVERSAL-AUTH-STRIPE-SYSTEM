import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import cookieParser from "cookie-parser"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import Stripe from "stripe"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean
} from "drizzle-orm/pg-core"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

dotenv.config()

const app = express()

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true
  })
)

app.use(cookieParser())

app.get("/", (req, res) => {
  const clientUrl = process.env.CLIENT_URL?.replace(/\/$/, "")

  if (clientUrl) {
    const requestHost = (req.get("x-forwarded-host") || req.get("host") || "").toLowerCase()

    try {
      const clientHost = new URL(clientUrl).host.toLowerCase()

      if (requestHost && clientHost === requestHost) {
        return res.status(200).json({
          ok: true,
          message: "API is running",
          health: "/health",
          warning: "CLIENT_URL points to this API host and causes redirect loops",
          expectedClientUrl: "https://<your-frontend-domain>"
        })
      }
    } catch {
      return res.status(200).json({
        ok: true,
        message: "API is running",
        health: "/health",
        warning: "CLIENT_URL is invalid",
        expectedClientUrl: "https://<your-frontend-domain>"
      })
    }

    return res.redirect(302, clientUrl)
  }

  return res.status(200).json({
    ok: true,
    message: "API is running",
    health: "/health",
    frontend: null
  })
})

// Stripe requires raw body for signature verification.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req: any, res) => {
    const sig = req.headers["stripe-signature"]

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig as string,
        process.env.STRIPE_WEBHOOK_SECRET as string
      )
    } catch (err: any) {
      console.error(err.message)
      return res.sendStatus(400)
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session
      const email = session.customer_email

      if (email) {
        const found = await db
          .select()
          .from(users)
          .where(eq(users.email, email))

        const user = found[0]

        if (user) {
          await db
            .update(users)
            .set({
              plan: "pro",
              credits: (user.credits || 0) + 500
            } as any)
            .where(eq(users.id, user.id))
        }
      }
    }

    return res.json({
      received: true
    })
  }
)

app.use(express.json())

const sql = postgres(process.env.DATABASE_URL as string)
const db = drizzle(sql)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-02-24.acacia"
})

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password"),
  stripeCustomerId: text("stripe_customer_id"),
  plan: text("plan").default("free"),
  credits: integer("credits").default(20),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow()
})

export const vaultEntries = pgTable("vault_entries", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull(),
  appSlug: text("app_slug").notNull(),
  keyName: text("key_name").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  secretLast4: text("secret_last4").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
})

const vaultUpsertSchema = z.object({
  appSlug: z.string().min(2).max(80),
  keyName: z.string().min(2).max(120),
  secretValue: z.string().min(8).max(5000)
})

const vaultResolveSchema = z.object({
  appSlug: z.string().min(2).max(80),
  keyName: z.string().min(2).max(120)
})

function getVaultMasterKey() {
  const raw = process.env.VAULT_MASTER_KEY

  if (!raw) {
    throw new Error("VAULT_MASTER_KEY is missing")
  }

  const decoded = Buffer.from(raw, "base64")

  if (decoded.length !== 32) {
    throw new Error("VAULT_MASTER_KEY must be a base64-encoded 32-byte key")
  }

  return decoded
}

function encryptSecret(secretValue: string) {
  const key = getVaultMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(secretValue, "utf8"),
    cipher.final()
  ])

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    secretLast4: secretValue.slice(-4).padStart(4, "*")
  }
}

function decryptSecret(payload: {
  ciphertext: string
  iv: string
  authTag: string
}) {
  const key = getVaultMasterKey()
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64")
  )

  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ])

  return decrypted.toString("utf8")
}

async function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.isAdmin === true) {
    return next()
  }

  const found = await db
    .select()
    .from(users)
    .where(eq(users.id, req.user.id))

  const user = found[0]

  if (!user || !user.isAdmin) {
    return res.status(403).json({
      error: "Admin access required"
    })
  }

  req.user.isAdmin = true
  next()
}

function createToken(user: any) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      plan: user.plan
    },
    process.env.JWT_SECRET as string,
    {
      expiresIn: "30d"
    }
  )
}

function devBypass(req: any, _res: any, next: any) {
  if (process.env.DEV_BYPASS_AUTH === "true") {
    req.user = {
      id: 999999,
      email: process.env.DEV_ADMIN_EMAIL,
      plan: "pro",
      isAdmin: true
    }

    return next()
  }

  next()
}

async function requireAuth(req: any, res: any, next: any) {
  if (req.user) {
    return next()
  }

  const token = req.cookies.token

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized"
    })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string)

    req.user = decoded

    next()
  } catch {
    return res.status(401).json({
      error: "Invalid token"
    })
  }
}

function requirePlan(plan: string) {
  return async (req: any, res: any, next: any) => {
    if (req.user.plan !== plan) {
      return res.status(403).json({
        error: "Upgrade required"
      })
    }

    next()
  }
}

function requireCredits(amount: number) {
  return async (req: any, res: any, next: any) => {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user.id))

    if (!user[0]) {
      return res.status(404).json({
        error: "User not found"
      })
    }

    if ((user[0].credits || 0) < amount) {
      return res.status(403).json({
        error: "Not enough credits"
      })
    }

    await db
      .update(users)
      .set({
        credits: (user[0].credits || 0) - amount
      } as any)
      .where(eq(users.id, req.user.id))

    next()
  }
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))

    if (existing.length > 0) {
      return res.status(400).json({
        error: "Email already exists"
      })
    }

    const hashed = await bcrypt.hash(password, 10)

    const customer = await stripe.customers.create({
      email
    })

    const inserted = await db
      .insert(users)
      .values({
        email,
        password: hashed,
        stripeCustomerId: customer.id
      } as any)
      .returning()

    const user = inserted[0]

    const token = createToken(user)

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    })

    return res.json({
      success: true,
      user
    })
  } catch (err) {
    console.error(err)

    return res.status(500).json({
      error: "Signup failed"
    })
  }
})

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body

    const found = await db.select().from(users).where(eq(users.email, email))

    const user = found[0]

    if (!user) {
      return res.status(400).json({
        error: "Invalid credentials"
      })
    }

    const valid = await bcrypt.compare(password, user.password || "")

    if (!valid) {
      return res.status(400).json({
        error: "Invalid credentials"
      })
    }

    const token = createToken(user)

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    })

    return res.json({
      success: true,
      user
    })
  } catch (err) {
    console.error(err)

    return res.status(500).json({
      error: "Login failed"
    })
  }
})

app.post("/api/auth/logout", async (_req, res) => {
  res.clearCookie("token")

  return res.json({
    success: true
  })
})

app.get("/api/auth/me", devBypass, requireAuth, async (req: any, res) => {
  return res.json({
    user: req.user
  })
})

app.post(
  "/api/billing/create-checkout",
  devBypass,
  requireAuth,
  async (req: any, res) => {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: req.user.email,
        line_items: [
          {
            price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID || "YOUR_STRIPE_PRICE_ID",
            quantity: 1
          }
        ],
        success_url: `${process.env.CLIENT_URL}/success`,
        cancel_url: `${process.env.CLIENT_URL}/billing`
      })

      return res.json({
        url: session.url
      })
    } catch (err) {
      console.error(err)

      return res.status(500).json({
        error: "Checkout failed"
      })
    }
  }
)

app.post(
  "/api/billing/buy-credits",
  devBypass,
  requireAuth,
  async (req: any, res) => {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: req.user.email,
        line_items: [
          {
            price: process.env.STRIPE_CREDIT_PRICE_ID || "YOUR_CREDIT_PRICE_ID",
            quantity: 1
          }
        ],
        success_url: `${process.env.CLIENT_URL}/credits-success`,
        cancel_url: `${process.env.CLIENT_URL}/credits`
      })

      return res.json({
        url: session.url
      })
    } catch (err) {
      console.error(err)

      return res.status(500).json({
        error: "Credit purchase failed"
      })
    }
  }
)

app.get("/api/protected", devBypass, requireAuth, async (req: any, res) => {
  return res.json({
    success: true,
    user: req.user
  })
})

app.post(
  "/api/ai/generate",
  devBypass,
  requireAuth,
  requireCredits(5),
  async (_req: any, res) => {
    return res.json({
      success: true,
      message: "AI generation completed",
      creditsUsed: 5
    })
  }
)

app.get(
  "/api/pro-feature",
  devBypass,
  requireAuth,
  requirePlan("pro"),
  async (_req, res) => {
    return res.json({
      success: true,
      feature: "Pro access granted"
    })
  }
)

app.get(
  "/api/vault/keys",
  devBypass,
  requireAuth,
  requireAdmin,
  async (req: any, res) => {
    const ownerUserId = req.user.id

    const rows = await db
      .select()
      .from(vaultEntries)
      .where(eq(vaultEntries.ownerUserId, ownerUserId))

    return res.json({
      success: true,
      keys: rows.map((row) => ({
        id: row.id,
        appSlug: row.appSlug,
        keyName: row.keyName,
        secretLast4: row.secretLast4,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    })
  }
)

app.post(
  "/api/vault/keys",
  devBypass,
  requireAuth,
  requireAdmin,
  async (req: any, res) => {
    try {
      const parsed = vaultUpsertSchema.parse(req.body)
      const ownerUserId = req.user.id

      const encrypted = encryptSecret(parsed.secretValue)

      const existing = await db
        .select()
        .from(vaultEntries)
        .where(
          and(
            eq(vaultEntries.ownerUserId, ownerUserId),
            eq(vaultEntries.appSlug, parsed.appSlug),
            eq(vaultEntries.keyName, parsed.keyName)
          )
        )

      if (existing[0]) {
        await db
          .update(vaultEntries)
          .set({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            secretLast4: encrypted.secretLast4,
            updatedAt: new Date()
          } as any)
          .where(eq(vaultEntries.id, existing[0].id))

        return res.json({
          success: true,
          entry: {
            id: existing[0].id,
            appSlug: parsed.appSlug,
            keyName: parsed.keyName,
            secretLast4: encrypted.secretLast4,
            updated: true
          }
        })
      }

      const inserted = await db
        .insert(vaultEntries)
        .values({
          ownerUserId,
          appSlug: parsed.appSlug,
          keyName: parsed.keyName,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          secretLast4: encrypted.secretLast4
        } as any)
        .returning()

      return res.json({
        success: true,
        entry: {
          id: inserted[0].id,
          appSlug: parsed.appSlug,
          keyName: parsed.keyName,
          secretLast4: encrypted.secretLast4,
          updated: false
        }
      })
    } catch (error: any) {
      return res.status(400).json({
        error: error?.message || "Invalid vault payload"
      })
    }
  }
)

app.post(
  "/api/vault/resolve",
  devBypass,
  requireAuth,
  requireAdmin,
  async (req: any, res) => {
    try {
      const parsed = vaultResolveSchema.parse(req.body)
      const ownerUserId = req.user.id

      const found = await db
        .select()
        .from(vaultEntries)
        .where(
          and(
            eq(vaultEntries.ownerUserId, ownerUserId),
            eq(vaultEntries.appSlug, parsed.appSlug),
            eq(vaultEntries.keyName, parsed.keyName)
          )
        )

      const entry = found[0]

      if (!entry) {
        return res.status(404).json({
          error: "Vault key not found"
        })
      }

      const secretValue = decryptSecret({
        ciphertext: entry.ciphertext,
        iv: entry.iv,
        authTag: entry.authTag
      })

      return res.json({
        success: true,
        appSlug: entry.appSlug,
        keyName: entry.keyName,
        secretValue
      })
    } catch (error: any) {
      return res.status(400).json({
        error: error?.message || "Invalid resolve payload"
      })
    }
  }
)

app.delete(
  "/api/vault/keys/:id",
  devBypass,
  requireAuth,
  requireAdmin,
  async (req: any, res) => {
    const id = Number(req.params.id)

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        error: "Invalid id"
      })
    }

    const ownerUserId = req.user.id

    const found = await db
      .select()
      .from(vaultEntries)
      .where(
        and(
          eq(vaultEntries.id, id),
          eq(vaultEntries.ownerUserId, ownerUserId)
        )
      )

    if (!found[0]) {
      return res.status(404).json({
        error: "Vault key not found"
      })
    }

    await db
      .delete(vaultEntries)
      .where(
        and(
          eq(vaultEntries.id, id),
          eq(vaultEntries.ownerUserId, ownerUserId)
        )
      )

    return res.json({
      success: true
    })
  }
)

app.get("/api/setup/check", async (_req, res) => {
  const requiredEnv = [
    "DATABASE_URL",
    "JWT_SECRET",
    "VAULT_MASTER_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_SUBSCRIPTION_PRICE_ID",
    "STRIPE_CREDIT_PRICE_ID",
    "CLIENT_URL"
  ]

  const missingEnv = requiredEnv.filter((key) => !process.env[key])

  let vaultKeyValid = false
  try {
    getVaultMasterKey()
    vaultKeyValid = true
  } catch {
    vaultKeyValid = false
  }

  let databaseConnected = false
  let usersTableExists = false
  let vaultEntriesTableExists = false

  try {
    await sql`select 1`
    databaseConnected = true

    const tables = (await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('users', 'vault_entries')
    `) as Array<{ table_name: string }>

    const existing = new Set(tables.map((table) => table.table_name))
    usersTableExists = existing.has("users")
    vaultEntriesTableExists = existing.has("vault_entries")
  } catch {
    databaseConnected = false
  }

  const stripeConfigPresent = Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_SUBSCRIPTION_PRICE_ID &&
      process.env.STRIPE_CREDIT_PRICE_ID
  )

  const checks = [
    {
      key: "env",
      label: "Required environment variables",
      ok: missingEnv.length === 0,
      details: missingEnv.length ? `Missing: ${missingEnv.join(", ")}` : "All required env vars are set"
    },
    {
      key: "vaultMasterKey",
      label: "Vault master key format",
      ok: vaultKeyValid,
      details: vaultKeyValid
        ? "VAULT_MASTER_KEY is a valid base64 32-byte key"
        : "VAULT_MASTER_KEY missing or invalid"
    },
    {
      key: "database",
      label: "Database connection",
      ok: databaseConnected,
      details: databaseConnected
        ? "Connected to PostgreSQL"
        : "Cannot connect to database"
    },
    {
      key: "usersTable",
      label: "Users table",
      ok: usersTableExists,
      details: usersTableExists
        ? "users table exists"
        : "users table is missing"
    },
    {
      key: "vaultTable",
      label: "Vault table",
      ok: vaultEntriesTableExists,
      details: vaultEntriesTableExists
        ? "vault_entries table exists"
        : "vault_entries table is missing"
    },
    {
      key: "stripe",
      label: "Stripe configuration",
      ok: stripeConfigPresent,
      details: stripeConfigPresent
        ? "Stripe keys and price IDs are set"
        : "Stripe keys or price IDs are missing"
    }
  ]

  return res.json({
    success: true,
    ready: checks.every((check) => check.ok),
    checks
  })
})

app.get("/health", async (_req, res) => {
  return res.json({
    success: true,
    status: "online"
  })
})

const PORT = process.env.PORT || 8080

app.listen(PORT, () => {
  console.log(`\n========================================\nAUTH SYSTEM RUNNING\nPORT: ${PORT}\n========================================\n`)
})
