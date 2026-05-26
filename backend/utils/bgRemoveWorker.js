/**
 * Standalone worker script: removes the background from one image and writes
 * the result as a PNG to a target path. Runs in its own Node process to avoid
 * the native-library conflict between sharp and @imgly/background-removal-node.
 *
 * Usage: node bgRemoveWorker.js <inputPath> <outputPath>
 * Exits 0 on success, non-zero on failure; prints errors on stderr.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
    console.error('Usage: node bgRemoveWorker.js <inputPath> <outputPath>');
    process.exit(2);
}

(async () => {
    try {
        const absInput = path.resolve(inputArg);
        const absOutput = path.resolve(outputArg);
        if (!fs.existsSync(absInput)) {
            console.error('Input file not found:', absInput);
            process.exit(3);
        }
        const { removeBackground } = await import('@imgly/background-removal-node');
        const blob = await removeBackground(pathToFileURL(absInput).href);
        const ab = await blob.arrayBuffer();
        fs.writeFileSync(absOutput, Buffer.from(ab));
        process.exit(0);
    } catch (err) {
        console.error('bg-removal failed:', err.message);
        process.exit(4);
    }
})();
