# Deploy to Netlify

## Option 1: Drag & Drop (Easiest)

1. **Build your project locally:**
   ```bash
   npm run build
   ```

2. **Go to Netlify:** https://app.netlify.com/drop

3. **Drag the `dist` folder** onto the deployment area

4. **Your site is live!** Netlify will give you a random URL like `https://amazing-name-123456.netlify.app`

## Option 2: Git Integration (Recommended)

1. **Push your code to GitHub/GitLab/Bitbucket**

2. **Go to Netlify:** https://app.netlify.com

3. **Click "Add new site" → "Import an existing project"**

4. **Connect your Git provider** and select your repository

5. **Configure build settings:**
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Node version:** 18

6. **Deploy!** Netlify will auto-deploy on every push

## Option 3: Netlify CLI

1. **Install Netlify CLI:**
   ```bash
   npm install -g netlify-cli
   ```

2. **Login to Netlify:**
   ```bash
   netlify login
   ```

3. **Build and deploy:**
   ```bash
   npm run build
   netlify deploy --prod --dir=dist
   ```

## Environment Variables (if needed)

If you have environment variables like `VITE_WALLETCONNECT_PROJECT_ID`:

1. **Go to your Netlify site dashboard**
2. **Site settings → Environment variables**
3. **Add your variables:**
   - `VITE_WALLETCONNECT_PROJECT_ID` = your_project_id
   - `VITE_GAS_RELAY_API_KEY` = your_api_key

## Custom Domain (Optional)

1. **Go to Site settings → Domain management**
2. **Add custom domain**
3. **Follow DNS configuration instructions**

## Features Included

✅ **Automatic HTTPS**
✅ **Global CDN**
✅ **Instant cache invalidation**
✅ **Branch previews**
✅ **Form handling**
✅ **Serverless functions** (if needed later)

Your emotional wellness platform will be live and accessible worldwide!