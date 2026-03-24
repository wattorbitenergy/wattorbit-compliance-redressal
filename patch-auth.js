const fs = require('fs');
const filePath = 'c:/Users/suraj/Desktop/industrial/wattorbit-compliance-redressal/backend/routes/authRoutes.js';
let content = fs.readFileSync(filePath, 'utf8');

// Patch 1: Add authLimiter to /register
content = content.replace(
  "router.post('/register', async (req, res) => {",
  "router.post('/register', authLimiter, async (req, res) => {"
);

// Patch 2: Add NoSQL protection to /register
content = content.replace(
  "let { username, password, city, phone, email, role, name, organisationId, specialization, referralCodeInput } = req.body;",
  "let { username, password, city, phone, email, role, name, organisationId, specialization, referralCodeInput } = req.body;\n\n    if (username !== undefined) username = String(username);\n    if (phone !== undefined) phone = String(phone);\n    if (email !== undefined) email = String(email);"
);

// Patch 3: Add authLimiter to /reset-password and cast token to string
const resetPasswordTarget = "router.post('/reset-password', async (req, res) => {\r\n  const hashed = crypto.createHash('sha256').update(req.body.token).digest('hex');";
const resetPasswordReplacement = `router.post('/reset-password', authLimiter, async (req, res) => {
  const tokenStr = String(req.body.token || '');
  const hashed = crypto.createHash('sha256').update(tokenStr).digest('hex');`;

content = content.replace(
  /router\.post\('\/reset-password',\s*async\s*\(req,\s*res\)\s*=>\s*\{\r?\n\s*const\s*hashed\s*=\s*crypto\.createHash\('sha256'\)\.update\(req\.body\.token\)\.digest\('hex'\);/,
  resetPasswordReplacement
);

fs.writeFileSync(filePath, content);
console.log('Successfully patched authRoutes.js');
