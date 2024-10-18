import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0';

let extractor;

// Initialize the pipeline
async function init() {
    extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-mpnet-base-v2",
        { quantized: false }
    );
}

// Get embedding for the input text
async function getEmbedding() {
    const inputText = document.getElementById('inputText').value;
    const output = document.getElementById('output');
    const timing = document.getElementById('timing');

    if (!extractor) {
        output.textContent = "Model is still loading. Please wait.";
        timing.textContent = "";
        return;
    }

    try {
        const startTime = performance.now();
        const result = await extractor(inputText, {
            pooling: "mean",
            normalize: true
        });
        const endTime = performance.now();

        output.textContent = JSON.stringify(result.data, null, 2);
        timing.textContent = `Embedding time: ${(endTime - startTime).toFixed(2)} ms`;
    } catch (error) {
        output.textContent = "Error: " + error.message;
        timing.textContent = "";
    }
}

// Initialize the model when the page loads
init();

// Make getEmbedding function available globally
window.getEmbedding = getEmbedding;
