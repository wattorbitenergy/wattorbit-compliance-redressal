const path = require('path');
const fs = require('fs');

console.log('--- Render Environment Diagnostic ---');
console.log('Current Working Directory (cwd):', process.cwd());
console.log('__dirname (of this file):', __dirname);

const potentialProjectRoots = [
    process.cwd(),
    path.join(__dirname, '..'),
    '/opt/render/project/src',
    '/opt/render/project'
];

potentialProjectRoots.forEach(root => {
    console.log(`\nChecking Root: ${root}`);
    const frontendPath = path.join(root, 'frontend/public/images');
    const backendPath = path.join(root, 'backend');

    console.log(`  Frontend Images Exists: ${fs.existsSync(frontendPath)}`);
    console.log(`  Backend Dir Exists: ${fs.existsSync(backendPath)}`);

    if (fs.existsSync(frontendPath)) {
        console.log(`  FOUND IMAGES AT: ${frontendPath}`);
        console.log(`  File Count: ${fs.readdirSync(frontendPath).length}`);
    }
});
