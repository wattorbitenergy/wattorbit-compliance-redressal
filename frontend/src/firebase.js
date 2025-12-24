// Minimal Firebase config for future use (Real-time notifications, etc.)
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";

// Your web app's Firebase configuration
// Replace these with your actual credentials from Firebase Console
const firebaseConfig = {
    apiKey: "PLACEHOLDER_API_KEY",
    authDomain: "wattorbit-redressal.firebaseapp.com",
    projectId: "wattorbit-redressal",
    storageBucket: "wattorbit-redressal.appspot.com",
    messagingSenderId: "PLACEHOLDER_SENDER_ID",
    appId: "PLACEHOLDER_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export default app;
