const path = require('path');
const fs = require('fs');

const routesDir = path.join(__dirname, 'routes');
const imagesDir = path.join(routesDir, '../../frontend/public/images');

console.log('__dirname:', __dirname);
console.log('Computed imagesDir:', imagesDir);
console.log('Absolute imagesDir:', path.resolve(imagesDir));
console.log('Exists:', fs.existsSync(imagesDir));

if (fs.existsSync(imagesDir)) {
    console.log('Files:', fs.readdirSync(imagesDir));
} else {
    // Try to find it
    console.log('Searching for images directory...');
    const root = path.resolve(__dirname, '..');
    console.log('Root:', root);
    const altPath = path.join(root, 'frontend/public/images');
    console.log('Alt Path:', altPath);
    console.log('Alt Exists:', fs.existsSync(altPath));
}
