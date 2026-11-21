# WaterGo — Cloudflare Pages build

## Deploy
1. Push this repository to GitHub.
2. In Cloudflare, open Workers & Pages → Create → Pages → Connect to Git.
3. Select the `Watergo` repository and deploy. Build command: `npm install`; build output directory: `public`.
4. In Pages → Settings → Variables and Secrets, add these **server-side** variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Use the existing Supabase project URL and publishable key for the first two. Add the service-role key as an encrypted secret only; never put it in frontend code or GitHub. Optional: `ALLOWED_ORIGIN` set to the deployed site origin.
5. Redeploy after adding variables.

The SQL migration in `supabase/001_watergo_marketplace.sql` was already applied to the connected Supabase project; do not run it again unless deliberately resetting the database.

## Notes
The frontend is served from `public/`; the authenticated API is a Cloudflare Pages Function at `/api/watergo-api`.
