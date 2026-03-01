const { resolve } = require("./src/resolve");
const { scan } = require("./src/scan");

async function run() {
  const input = process.argv[2];
  const mode = process.argv[3] || "text";

  if (!input) {
    console.log("Usage: node index.js <CA|symbol> [text|json|roast]");
    process.exit(1);
  }

  // allow passing a symbol/name later (resolve can map -> CA)
  const ca = await resolve(input);

  const result = await scan(ca, mode);

  if (mode === "json") console.log(JSON.stringify(result, null, 2));
  else console.log(result.textOutput);
}

run().catch((err) => {
  console.error("Run failed:", err?.message || err);
  process.exit(1);
});


