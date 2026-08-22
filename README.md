# eBilikAgamaTV

A modern Malaysian TV streaming website with live Twitch integration, TV program schedule (EPG), and admin panel.

## Features

- **Public Homepage** — Saluran TV and Saluran Khas sections with live stream cards
- **Twitch Integration** — Embedded live streams with verification system
- **TV Program Schedule (EPG)** — Real-time program schedule with date/channel selectors
- **Admin Panel** — Full management of channels, schedule, and admin accounts
- **Real-time Updates** — SSE-based live updates across all connected clients
- **Owner/Admin Roles** — Secure authentication with role-based access control

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Prisma + PostgreSQL
- **Auth:** JWT with bcrypt password hashing
- **Styling:** Tailwind CSS 4
- **Streaming:** Twitch Embed Player

## Deployment (Vercel)

### Step 1: Create a PostgreSQL Database (Free)

Use one of these free PostgreSQL providers:

- **Neon** (recommended): https://neon.tech — Free tier: 0.5 GB storage
- **Supabase**: https://supabase.com — Free tier: 500 MB storage
- **Vercel Postgres**: Available in Vercel project settings → Storage

Copy the connection string (looks like `postgresql://username:password@host:5432/dbname?sslmode=require`).

### Step 2: Deploy to Vercel

1. Go to https://vercel.com
2. Click **"New Project"**
3. Import your GitHub repository: `ebilikagama`
4. Set **Environment Variables**:
   - `DATABASE_URL` = your PostgreSQL connection string
   - `JWT_SECRET` = a secure random string (generate at https://generate-secret.vercel.app/32)
5. Click **Deploy**

The build process automatically:
- Pushes the Prisma schema to your database
- Seeds channels, settings, and owner account
- Builds the Next.js application

**No manual database setup needed!** Just set the `DATABASE_URL` and deploy.

### Step 3 (Optional): Re-seed the Database

If you need to re-seed the database after making changes:

```bash
vercel link
vercel env pull .env.local
npx prisma db push
npx tsx prisma/seed.ts
```

**Note:** The seed script is idempotent — it won't duplicate existing data.

### Step 4: Access the Website

- **Public site:** `https://your-project.vercel.app`
- **Admin panel:** `https://your-project.vercel.app/admin/login`

### Admin Credentials

| Role | Username | Access |
|------|----------|--------|
| OWNER | muhammadferousmsa | Full access (channels, schedule, admin management, settings) |
| ADMIN | (created by owner) | Limited access (channels, schedule) |

## Local Development

```bash
# Install dependencies
npm install

# Set up database
cp .env.example .env
# Edit .env with your PostgreSQL connection string

# Push schema and seed
npx prisma db push
npx tsx prisma/seed.ts

# Start dev server
npm run dev
```

Open http://localhost:3000

## Project Structure

```
src/
├── app/
│   ├── admin/           # Admin Panel pages
│   │   ├── login/       # Admin login
│   │   ├── channels/    # Channel management
│   │   ├── schedule/    # TV schedule management
│   │   ├── admins/      # Admin account management (owner only)
│   │   ├── account/     # Account settings
│   │   └── settings/    # Website settings
│   ├── api/             # API routes
│   │   ├── auth/        # Authentication endpoints
│   │   ├── channels/    # Channel CRUD + SSE events
│   │   ├── programs/    # Program CRUD + SSE events
│   │   ├── admins/      # Admin management (owner only)
│   │   └── upload/      # File upload (base64)
│   ├── channels/        # Public channel viewing page
│   └── page.tsx         # Public homepage
├── components/          # React components
│   ├── ProgramSchedule.tsx  # EPG schedule component
│   ├── TwitchPlayer.tsx     # Twitch embed player
│   ├── TwitchVerifyPreview.tsx  # Channel verification
│   └── ...
└── lib/
    ├── auth.ts          # JWT authentication
    ├── prisma.ts        # Database client
    ├── channel-events.ts    # Channel SSE events
    └── program-events.ts    # Program SSE events
```

## Admin Credentials

| Role | Username | Access Level |
|------|----------|--------------|
| OWNER | muhammadferousmsa | Full access |
| ADMIN | (created by owner) | Limited |

## License

Private — eBilikAgama
