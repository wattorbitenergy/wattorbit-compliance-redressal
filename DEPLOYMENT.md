# Deployment Guide - WattOrbit Compliance Redressal

This project is divided into a **Backend** (Node.js/Express) and a **Frontend** (React/Vite).

## 1. Backend Deployment

### Recommended Platforms
- **Render** (easiest)
- **Railway**
- **Heroku**
- **DigitalOcean App Platform**

### Steps
1. Push the code to a GitHub repository.
2. Select the `backend` folder as the root for your backend service.
3. Set the build command: `npm install`
4. Set the start command: `npm start`
5. Configure the following **Environment Variables**:
   - `MONGO_URI`: Your MongoDB Atlas connection string.
   - `JWT_SECRET`: A long random string for security.
   - `SMTP_USER`: Your Gmail address.
   - `SMTP_PASS`: Your Gmail App Password (not your regular password).
   - `SMTP_HOST`: `smtp.gmail.com`
   - `SMTP_PORT`: `587`
   - `NODE_ENV`: `production`

---

## 2. Frontend Deployment

### Recommended Platforms
- **Vercel**
- **Netlify**
- **Firebase Hosting**

### Steps
1. Push the code to GitHub.
2. Select the `frontend` folder as the root.
3. Set the build command: `npm run build`
4. Set the output directory: `dist`
5. Configure **Environment Variables**:
   - `VITE_API_URL`: The URL of your deployed backend (e.g., `https://wattorbit-api.onrender.com`).

---

## 3. Android APK Generation

### Prerequisites
- Android Studio installed.
- JDK 17 or higher.

### Steps
1. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```
2. Sync with Capacitor:
   ```bash
   npx cap sync
   ```
3. Open the `frontend/android` folder in Android Studio.
4. Go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. The APK will be generated at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

---

## 4. Cloud Logon (Email & SMS)
- **Email**: Uses Gmail SMTP. Ensure "2-Step Verification" is ON and generate an **App Password**.
- **SMS**: Uses Fast2SMS. Sign up and get an API Key to enable SMS notifications for password resets.
