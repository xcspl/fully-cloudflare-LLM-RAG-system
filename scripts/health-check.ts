// Health check for the deployed gAIa Worker.
// Run: curl https://<worker-url>/health
// Or: npx tsx scripts/health-check.ts <worker-url>

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/health-check.ts <worker-url>");
    console.error("Example: npx tsx scripts/health-check.ts https://gaia.<subdomain>.workers.dev");
    process.exit(1);
  }

  const base = url.replace(/\/$/, "");
  console.log(`Checking: ${base}/health\n`);

  try {
    const resp = await fetch(`${base}/health`);
    const body = await resp.json();
    console.log(`Status: ${resp.status}`);
    console.log(`D1: ${body.d1 ?? "missing"}`);
    console.log(`Vectorize: ${body.vectorize ?? "missing"}`);
    process.exit(resp.ok ? 0 : 1);
  } catch (e) {
    console.error(`Failed to reach worker: ${e}`);
    process.exit(1);
  }
}

main();
