# OmniTestAI Forge

A trimmed, generation-focused build of OmniTestAI. This is **not** a fork of the
full product — it's a smaller tool built from the same codebase, kept only for
the parts you asked for:

- **Overview** (Dashboard)
- **Test Cases** (Repository)
- **AI Test Design** (Generator)
- **Test Data** (Test Data Manager)

## What changed vs. the original OmniTestAI

1. **New dark theme.** `client/src/index.css` has a fresh design-token palette
   (deep navy base, cyan → indigo accent). The four kept screens were passed
   through a colour remap since they lean on inline styles rather than the
   shared CSS classes.
2. **Only four sections.** Everything else — Execution Lab, Knowledge Space,
   Analytics, Token & Cost, Admin Console — has been removed from both the
   client (`App.tsx`, `Sidebar.tsx`) and the server (`main.py` only wires up
   `health`, `auth` (apps only), `tests`, `generate`, `dashboard`, `test_data`,
   `scout`).
3. **No login, no roles.** `server/app/auth/middleware.py` no longer checks a
   cookie or JWT — every request is treated as one shared, always-authenticated
   account. There's no `LoginPage`, `ProtectedRoute`, or `AuthContext` on the
   client. Anyone with the URL can use it.
4. **Sidebar rebuilt + bug fixed.** The app-name truncation bug (long
   application names not getting an ellipsis) is fixed by putting the name in
   a real `<button>` with `min-width: 0` set at *every* level of the flex
   chain — see the comment at the top of `client/src/components/Sidebar.tsx`
   for why the old version didn't work. A standalone patch of just this fix,
   for your original OmniTestAI repo (roles/nav intact), is included
   separately as `Sidebar.fixed.tsx`.

## Running it

Same as the original — see `server/README.md` and `client/README.md`. Quick
version:

```bash
# backend
cd server
pip install -r requirements.txt   # or however you normally set it up
cp .env.example .env              # fill in GEMINI_API_KEY, DATABASE_URL, etc.
uvicorn main:app --reload

# frontend
cd client
npm install
npm run dev
```

No login screen will appear — you land straight on Overview.
