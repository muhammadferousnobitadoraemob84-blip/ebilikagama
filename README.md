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

### Step 1: Create PostgreSQL Database

Use one of these free PostgreSQL providers:

- **Vercel Postgres:** Go to your Vercel project → Storage → Create Database → PostgreSQL
- **Neon:** https://neon.tech (free tier, 0.5GB storage)
- **Supabase:** https://supabase.com (free tier, 500MB storage)

Copy the connection string (it looks like `postgresql://...`).

### Step 2: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/ebilikagama-repo.git
git push -u origin main
```

### Step 3: Deploy to Vercel

1. Go to https://vercel.com
2. Click "New Project"
3. Import your GitHub repository
4. Set environment variables:
   - `DATABASE_URL` = your PostgreSQL connection string
   - `JWT_SECRET` = a secure random string (e.g., from https://generate-secret.vercel.app/32)
5. Click "Deploy"
6. After deployment, Vercel will show your live URL

### Step 4: Initialize the Database

After first deploy, run the seed command:

```bash
# Via Vercel CLI
vercel env pull .env.local
npx prisma db push
npx tsx prisma/seed.ts

# Or set up a build step to auto-seed
```

### Step 5: Access Admin Panel

1. Visit your deployed URL
2. Click "⚙ Admin" in the footer
3. Login with:
   - **Username:** muhammadferousmsa
   - **Password:** MuhammadFerous40*****

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
│   │   └── upload/      # File upload
│   ├── channels/        # Public channel viewing page
│   └── page.tsx         # Public homepage
├── components/          # React components
│   ├── ProgramSchedule.tsx  # EPG schedule component
│   ├── TwitchPlayer.tsx     # Twitch embed player
│   ├── TwitchVerifyPreview.tsx  # Channel verification
│   ├── ChannelCard.tsx      # Channel card
│   └── ...
└── lib/
    ├── auth.ts          # JWT authentication
    ├── prisma.ts        # Database client
    ├── channel-events.ts    # Channel SSE events
    └── program-events.ts    # Program SSE events
```

## Admin Credentials

| Role   | Username           | Access Level |
|--------|--------------------|--------------|
| OWNER  | muhammadferousmsa  | Full access  |
| ADMIN  | (created by owner) | Limited      |

## License

Private - eBilikAgama
