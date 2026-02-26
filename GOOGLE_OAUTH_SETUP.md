# Google OAuth Setup Guide

## Prerequisites
- Supabase project
- Google Cloud Console access

## Step 1: Configure Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure the OAuth consent screen if not done already
6. For Application type, select **Web application**
7. Add authorized redirect URIs:
   ```
   https://YOUR_SUPABASE_PROJECT_ID.supabase.co/auth/v1/callback
   ```
8. Copy your **Client ID** and **Client Secret**

## Step 2: Configure Supabase

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Providers**
3. Find **Google** and enable it
4. Paste your Google OAuth **Client ID** and **Client Secret**
5. Save the configuration

## Step 3: Configure Backend Environment

Add to your `.env` file:

```bash
# Frontend URL for OAuth redirects
FRONTEND_URL=https://motokaapp.ng
# For local development:
# FRONTEND_URL=http://localhost:3000
```

## Step 4: Deploy Backend Changes

The OAuth controller and routes have been added to your backend. Deploy the changes:

```bash
cd backend
git add .
git commit -m "Add Google OAuth support"
git push origin main
```

Then redeploy on Render.

## Step 5: Deploy Frontend Changes

```bash
cd ../Motoka-frontend
git add .
git commit -m "Enable Google OAuth login and signup"
git push origin master
```

Then redeploy on Vercel.

## Testing

1. Go to your signup page: `https://motokaapp.ng/auth/signup`
2. Click the Google button
3. You should be redirected to Google's OAuth consent screen
4. After authorization, you'll be redirected back and logged in

## Troubleshooting

### "redirect_uri_mismatch" error
- Make sure the redirect URI in Google Cloud Console exactly matches:
  `https://YOUR_SUPABASE_PROJECT_ID.supabase.co/auth/v1/callback`

### "Invalid OAuth callback" error
- Check that `FRONTEND_URL` in your backend `.env` is correct
- Verify that the `/auth/callback` route is deployed in your frontend

### User not redirected to dashboard
- Check browser console for errors
- Verify that tokens are being stored correctly
- Check that the OAuth callback handler is working

## Security Notes

- Never commit Google OAuth credentials to version control
- Use environment variables for all sensitive configuration
- Configure OAuth consent screen properly before going to production
- Review Google's OAuth policies and user data access requirements
