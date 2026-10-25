export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { assertRuntimeConfig } = await import("@adel/core");
      assertRuntimeConfig();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
}
