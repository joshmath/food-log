# Food Log

A small, single-user food diary. Plain HTML/CSS/JS hosted on GitHub Pages, with
Supabase for the login and database. No build step.

## Run it locally

Double-click **`serve.cmd`**. It starts a small local server and opens
<http://localhost:5174> in your browser. Close the window to stop it.
(Opening `index.html` directly from the folder won't work.)

Local testing uses the **same Supabase data** as the live site. To test with
throwaway data instead, blank out the two keys in `config.js`: the app switches
to **demo mode** and saves to this browser only. Put the keys back before you
commit.

## One-time setup

### 1. Supabase (login + database)

1. Go to <https://supabase.com>, sign up, and click **New project**.
   Name it `food-log`, pick a region near you, and set a database password
   (save it somewhere; the app doesn't need it).
2. When the project is ready, open **SQL Editor** → **New query**, paste the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Open **Authentication** → **Users** → **Add user** → **Create new user**.
   Enter your email and the password you want to use for the app, and tick
   **Auto Confirm User**.
4. Open **Authentication** → **Sign In / Providers** and turn **off**
   "Allow new users to sign up". This makes you the only possible user.
5. Click **Connect** at the top of the project (or **Project Settings** →
   **API Keys**) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable** key (`sb_publishable_...`), or the legacy **anon** key

   Paste both into `config.js`. Never use the **secret** / `service_role` key here.

### 2. GitHub Pages (hosting)

1. Create an empty public repo named `food-log` on GitHub.
2. Push this folder to it.
3. In the repo, open **Settings** → **Pages**, set **Source** to
   "Deploy from a branch", branch `main`, folder `/ (root)`, and save.
4. After a minute the app is live at `https://<your-username>.github.io/food-log/`.

### 3. On your phone

Open the URL, sign in once, then use **Share → Add to Home Screen** (iPhone) or
**⋮ → Add to Home screen** (Android) so it opens like an app.

## Why the keys in `config.js` are safe to publish

The publishable key only lets a browser *ask* Supabase to sign in. Every table
has row level security that returns nothing unless the request carries your
login, and sign-ups are turned off, so nobody else can get an account.
