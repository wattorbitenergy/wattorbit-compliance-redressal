/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'watt-blue': '#0056b3', // Example brand color
                'watt-green': '#28a745',
            }
        },
    },
    plugins: [],
}
